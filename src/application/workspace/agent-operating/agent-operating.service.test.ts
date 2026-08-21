import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppliedResult } from '../../../core/verification/test/verification.fixture';
import { CorrectionLoopService } from '../correction-loop';
import { VERIFICATION_REPORT } from '../../../ui/workspace/test/workspace.fixture';
import { AgentOperatingService } from './agent-operating.service';
import { AgentRunPersistence } from './agent-run.persistence';
import { AgentRunService } from './agent-run.service';
import { ExplainArtifactPersistence } from './explain-artifact.persistence';
import type {
  AgentOperatingInvestigationPort,
  AgentOperatingRuntimePort,
} from './agent-operating.types';

describe('P1-A Step 2 AgentOperatingService', () => {
  let stateRoot: string;
  let agentRuns: AgentRunService;
  let investigation: AgentOperatingInvestigationPort;
  let runtime: AgentOperatingRuntimePort;
  let correction: CorrectionLoopService;
  let service: AgentOperatingService;
  let prepareCalls: number;
  let applyCalls: number;
  let fileApplyCalls: number;

  beforeEach(async () => {
    stateRoot = await mkdtemp(path.join(os.tmpdir(), 'builderai-agent-op-'));
    agentRuns = new AgentRunService(
      new AgentRunPersistence(stateRoot, 'project-a'),
      () => new Date('2026-08-21T12:00:00.000Z'),
    );
    prepareCalls = 0;
    applyCalls = 0;
    fileApplyCalls = 0;

    investigation = {
      investigate: vi.fn(
        async (request: string) =>
          ({
            investigationId: 'inv-1',
            request,
            report: {
              schemaVersion: 1 as const,
              investigationId: 'inv-1',
              summary: 'Found candidate',
              confidence: 'MEDIUM' as const,
              hypotheses: [],
              evidence: [],
              affectedAreas: [],
              recommendedNextSteps: [],
              limitations: [],
            },
            searchResult: {
              schemaVersion: 1,
              matches: [],
              queries: [],
              truncated: false,
            },
            repositorySourcePaths: [],
            bounded: true,
          }) as never,
      ),
      resolveInvestigationHandoff: vi.fn(() => undefined),
    };

    runtime = {
      prepare: vi.fn(async () => {
        prepareCalls += 1;
        return {
          preparationId: 'prep-1',
          expiresAt: '2026-08-21T13:00:00.000Z',
          responsePackage: { schemaVersion: 1 } as never,
          changePlan: { schemaVersion: 1 } as never,
          gate2Review: {
            schemaVersion: 1 as const,
            operationDiffs: [],
            totalCharacterCount: 0,
            truncated: false,
          },
          outcome: { kind: 'READY_FOR_REVIEW' as const },
        };
      }),
      approveAndApply: vi.fn(async (_id, approved) => {
        applyCalls += 1;
        if (!approved) {
          throw Object.assign(new Error('APPROVAL_REQUIRED'), { code: 'APPROVAL_REQUIRED' });
        }
        fileApplyCalls += 1;
        return {
          applyResult: createAppliedResult({ updatedFiles: ['src/example.ts'] }),
          verificationReport: { ...VERIFICATION_REPORT, status: 'PASSED' as const },
        };
      }),
    };

    correction = new CorrectionLoopService();
    service = new AgentOperatingService({
      projectId: 'project-a',
      agentRuns,
      explainArtifacts: new ExplainArtifactPersistence(stateRoot, 'project-a'),
      investigation,
      runtime,
      correction,
      ids: { generate: () => 'run-fixed' },
      clock: { now: () => new Date('2026-08-21T12:00:00.000Z') },
    });
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it('startRun creates UNDERSTANDING with investigation reference', async () => {
    const { run, investigation: inv } = await service.startRun('Add banner');
    expect(run.phase).toBe('UNDERSTANDING');
    expect(run.status).toBe('RUNNING');
    expect(run.references.investigationId).toBe('inv-1');
    expect(inv.investigationId).toBe('inv-1');
    expect(fileApplyCalls).toBe(0);
  });

  it('plan stores preparation reference and never mutates', async () => {
    await service.startRun('Plan only');
    const planned = await service.plan('run-fixed');
    expect(planned.run.phase).toBe('PLANNING');
    expect(planned.run.references.preparationId).toBe('prep-1');
    expect(planned.run.references.workflowId).toBe('prep-1');
    expect(planned.preparationId).toBe('prep-1');
    expect(prepareCalls).toBe(1);
    expect(fileApplyCalls).toBe(0);
    expect(applyCalls).toBe(0);
    expect(JSON.stringify(planned.run)).not.toMatch(/changePlan|artifacts|content/);
  });

  it('pauseAtGate2 transitions to AWAITING_GATE2 without approving', async () => {
    await service.startRun('Gate pause');
    await service.plan('run-fixed');
    const paused = await service.pauseAtGate2('run-fixed');
    expect(paused.run.phase).toBe('AWAITING_GATE2');
    expect(paused.run.status).toBe('AWAITING_GATE2');
    expect(paused.gate2Review.schemaVersion).toBe(1);
    expect(applyCalls).toBe(0);
    expect('approve' in service).toBe(false);
  });

  it('cannot execute before Gate 2', async () => {
    await service.startRun('Too early');
    await service.plan('run-fixed');
    await expect(
      service.executeAfterApproval('run-fixed', { approved: true }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(applyCalls).toBe(0);
  });

  it('cannot invent approval — approved:false fails via existing runtime', async () => {
    await service.startRun('Need approval');
    await service.plan('run-fixed');
    await service.pauseAtGate2('run-fixed');
    await expect(
      service.executeAfterApproval('run-fixed', { approved: false }),
    ).rejects.toBeTruthy();
    expect(fileApplyCalls).toBe(0);
  });

  it('approved execute delegates to approveAndApply as sole mutation path', async () => {
    await service.startRun('Execute');
    await service.plan('run-fixed');
    await service.pauseAtGate2('run-fixed');
    const result = await service.executeAfterApproval('run-fixed', { approved: true });
    expect(applyCalls).toBe(1);
    expect(fileApplyCalls).toBe(1);
    expect('completion' in result).toBe(true);
    if ('completion' in result) {
      expect(result.run.phase).toBe('VERIFYING');
      expect(result.completion.applyResult.status).toBe('APPLIED');
    }
  });

  it('cancel delegates to AgentRun cancel and correction cancel when present', async () => {
    await service.startRun('Cancel');
    const cancelled = await service.cancel('run-fixed');
    expect(cancelled.run.phase).toBe('CANCELLED');
  });

  it('verification failure enters existing CorrectionLoopService', async () => {
    runtime.approveAndApply = vi.fn(async () => {
      applyCalls += 1;
      fileApplyCalls += 1;
      return {
        applyResult: createAppliedResult({ updatedFiles: ['src/example.ts'] }),
        verificationReport: { ...VERIFICATION_REPORT, status: 'FAILED' as const },
      };
    });
    await service.startRun('Fail verify');
    await service.plan('run-fixed');
    await service.pauseAtGate2('run-fixed');
    const result = await service.executeAfterApproval('run-fixed', { approved: true });
    expect('correctionWorkflowId' in result).toBe(true);
    if ('correctionWorkflowId' in result) {
      expect(result.run.phase).toBe('CORRECTING');
      expect(result.run.references.correctionWorkflowId).toBe('prep-1');
      expect(result.canPrepareCorrection).toBe(true);
      const session = await correction.getSession(result.correctionWorkflowId);
      expect(session).toBeDefined();
    }
  });

  it('explain uses existing evidence without secrets or raw bodies', async () => {
    await service.startRun('Explain');
    await service.plan('run-fixed');
    await service.pauseAtGate2('run-fixed');
    await service.executeAfterApproval('run-fixed', { approved: true });
    const explained = await service.explain('run-fixed');
    expect(explained.run.phase).toBe('COMPLETED');
    expect(explained.explanation.summary.toLowerCase()).not.toMatch(
      /api[_-]?key\s*[=:]|bearer [a-z0-9]|password\s*[=:]/,
    );
    expect(JSON.stringify(explained.explanation)).not.toMatch(
      /screenshot|stdout|stderr|fileContents|promptPackage/,
    );
    expect(explained.explanation.applyStatus).toBe('APPLIED');
    expect(explained.explanation.verificationStatus).toBe('PASSED');
    expect(explained.explain.approvals.gate2CyclesObserved).toBe(1);
    expect(explained.explain.browserVerification.availability.status).toBe('UNAVAILABLE');

    const loaded = await service.getExplainArtifact('run-fixed');
    expect(loaded.persisted).toBe(true);
    expect(loaded.explain.summary).toBe(explained.explain.summary);
  });

  it('restart at AWAITING_GATE2 never auto-applies', async () => {
    await service.startRun('Restart safe');
    await service.plan('run-fixed');
    await service.pauseAtGate2('run-fixed');

    const restartedRuns = new AgentRunService(new AgentRunPersistence(stateRoot, 'project-a'));
    const restarted = new AgentOperatingService({
      projectId: 'project-a',
      agentRuns: restartedRuns,
      explainArtifacts: new ExplainArtifactPersistence(stateRoot, 'project-a'),
      investigation,
      runtime,
      correction: new CorrectionLoopService(),
      ids: { generate: () => 'unused' },
      clock: { now: () => new Date('2026-08-21T14:00:00.000Z') },
    });
    await restarted.hydrate();
    const run = await restarted.getRun('run-fixed');
    expect(run.phase).toBe('AWAITING_GATE2');
    expect(applyCalls).toBe(0);
    expect(fileApplyCalls).toBe(0);
  });

  it('invalid AgentRun transition fails closed', async () => {
    await service.startRun('Invalid');
    await expect(service.pauseAtGate2('run-fixed')).rejects.toMatchObject({
      code: 'INVALID_REFERENCE',
    });
  });
});
