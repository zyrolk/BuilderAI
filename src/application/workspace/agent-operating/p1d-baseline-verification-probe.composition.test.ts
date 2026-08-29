/**
 * @vitest-environment node
 *
 * P1-D Slice 1 — Governed Baseline Engineering Verification Probe (ADR-049).
 * Proves: UNDERSTANDING baseline verify → investigate → plan → Gate2 → approve → apply → COMPLETED
 * with zero FileApply before explicit approval.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ChangePlannerService } from '../../../core/change-planner';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../../core/target-project/test/external-target.fixture';
import { InMemoryAppliedFileApplyBindingStore } from '../controlled-git/applied-file-apply-binding.port';
import { createControlledLocalBrowserService } from '../tool-registry/create-b7-browser-registry';
import { createControlledGitService } from '../tool-registry/create-b5-git-registry';
import { createControlledTerminalService } from '../tool-registry/create-b4-terminal-registry';
import { EditProposalService } from '../edit-proposal/edit-proposal.service';
import type { ExternalTargetReadiness } from '../external-target-readiness/external-target-readiness.types';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { createAgentLoopComposition } from '../agent-loop';
import { AgentLoopEvidencePersistence } from '../agent-loop/agent-loop.persistence';
import { AgentOperatingService } from './agent-operating.service';
import { buildOperatorToolPlanningContext } from './operator-tool-planning-context';
import {
  createAgentCompositionHarness,
  createStubInvestigation,
  type AgentCompositionHarness,
} from './test/agent-operating.composition.fixture';
import { isOperatorToolPlanningMergeInput } from './operator-tool-planning-prepare-input';
import type { AgentOperatingRuntimePort } from './agent-operating.types';
import type { AgentLoopService } from '../agent-loop/agent-loop.service';

export const P1D_BASELINE_VERIFICATION_PROBE_BENCHMARK_ID =
  'p1d-baseline-verification-probe-v1' as const;

export interface P1dBaselineVerificationProbeEvidence {
  readonly benchmarkId: typeof P1D_BASELINE_VERIFICATION_PROBE_BENCHMARK_ID;
  readonly runId: string;
  readonly phasesObserved: readonly string[];
  readonly fileApplyCallsBeforeApproval: number;
  readonly fileApplyCallsAfterApproval: number;
  readonly baselineVerifyInUnderstanding: boolean;
  readonly b4EvidenceWithoutPlanningProjection: boolean;
  readonly verificationStatus: string | null;
  readonly finalPhase: string;
  readonly finalStatus: string;
}

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function readinessStub(projectId = 'builder-ai'): ExternalTargetReadiness {
  return {
    schemaVersion: 1,
    status: 'READY',
    profile: 'EXTERNAL_TARGET',
    projectId,
    projectName: 'zyro-style-fixture',
    projectRootDisplay: '.',
    runtimeConnected: true,
    sourceRoots: ['src'],
    testRoots: ['tests'],
    governanceDocuments: [],
    indexedFileCount: 10,
    protectedAreas: [],
    verification: {
      build: true,
      test: true,
      lint: true,
      typecheck: true,
      format: false,
      devServer: false,
      browserVerification: false,
    },
    warnings: [],
    blockers: [],
  };
}

interface ComposedAgent {
  readonly agent: AgentOperatingService;
  readonly loop: AgentLoopService;
  readonly capturedPrepareInputs: unknown[];
}

function composeAgentWithLoop(
  harness: AgentCompositionHarness,
  stateRoot: string,
  runId: string,
  projectRoot: string,
): ComposedAgent {
  const projectId = 'builder-ai';
  const capturedPrepareInputs: unknown[] = [];
  const authorization = new WorkspaceAuthorizationService({
    profile: 'TRUSTED_LOCAL',
    projectId,
    principalId: 'local-operator',
  });
  const source = {
    listSourcePaths: async () => ['src/integration-output.ts'],
    readSourceFile: async () => 'export const integration = true;\n',
  };
  let idSeq = 0;
  const editProposals = new EditProposalService({
    changePlanner: new ChangePlannerService(),
    preparePort: {
      prepareFromResponsePackage: async () => {
        throw new Error('prepareFromResponsePackage unused in P1-D benchmark');
      },
    },
    clock: { now: () => new Date('2026-08-29T10:00:00.000Z') },
    ids: {
      generate: () => {
        idSeq += 1;
        return `p1d-${String(idSeq).padStart(4, '0')}`;
      },
    },
    expectedBaselineDigest: 'b',
    readBaselineDigest: async () => 'b',
  });
  const controlledTerminal = createControlledTerminalService();
  const controlledGit = createControlledGitService({
    appliedBindings: new InMemoryAppliedFileApplyBindingStore(),
  });
  const controlledBrowser = createControlledLocalBrowserService({
    serverManagerFactory: () => ({
      start: async () => ({
        descriptorId: 'npm-run-dev',
        status: 'UNAVAILABLE',
        startupDurationMs: 0,
        policyBlockCode: 'TEST_STUB',
      }),
      shutdown: async () => undefined,
    }),
    browserRunner: {
      verify: async () => ({
        status: 'UNAVAILABLE',
        durationMs: 0,
        routes: [],
        consoleErrorCount: 0,
        pageExceptionCount: 0,
        failedRequestCount: 0,
      }),
    },
  });
  const loopPersistence = new AgentLoopEvidencePersistence(stateRoot, projectId);
  const composed = createAgentLoopComposition({
    projectId,
    authorization,
    search: source,
    read: { readSourceFile: source.readSourceFile },
    readiness: { project: async () => readinessStub(projectId) },
    related: source,
    relevantContext: source,
    outline: { readSourceFile: source.readSourceFile },
    imports: source,
    editProposals,
    controlledTerminal,
    controlledGit,
    controlledBrowser,
    persistence: loopPersistence,
    clock: { now: () => new Date('2026-08-29T10:00:00.000Z') },
  });

  const runtime: AgentOperatingRuntimePort = {
    prepare: async (request, iterationFeedbackInput, cancellation) => {
      capturedPrepareInputs.push(iterationFeedbackInput);
      return harness.runtime.prepare(request, iterationFeedbackInput, cancellation);
    },
    approveAndApply: harness.runtime.approveAndApply.bind(harness.runtime),
  };

  const agent = new AgentOperatingService({
    projectId,
    agentRuns: harness.agentRuns,
    explainArtifacts: harness.explainArtifacts,
    investigation: createStubInvestigation(),
    runtime,
    correction: harness.correction,
    ids: { generate: () => runId },
    clock: { now: () => new Date('2026-08-29T10:00:00.000Z') },
    loop: composed.loop,
    projectRoot,
    security: {
      profile: 'TRUSTED_LOCAL',
      projectId,
      principalId: 'local-operator',
    },
  });

  return { agent, loop: composed.loop, capturedPrepareInputs };
}

describe('P1-D baseline verification probe benchmark', () => {
  it('records baseline verify → investigate → plan → Gate2 → approve → apply → COMPLETED', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1d-baseline-'));
    const runId = 'p1d-baseline-run';
    const projectRoot = ZYRO_STYLE_FIXTURE_ROOT;
    try {
      const harness = createAgentCompositionHarness({ stateRoot, runId });
      const { agent, loop, capturedPrepareInputs } = composeAgentWithLoop(
        harness,
        stateRoot,
        runId,
        projectRoot,
      );
      const { fileApply, fileSystem } = harness;
      const phasesObserved: string[] = [];

      const started = await agent.startRun('P1-D baseline verification probe benchmark.');
      phasesObserved.push(started.run.phase);
      expect(started.run.phase).toBe('UNDERSTANDING');
      expect(fileApply.calls).toBe(0);

      const catalogTurn = await agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'inspect_verification_catalog',
            intentId: 'p1d-catalog-1',
            arguments: {},
          },
        ],
        cancellation: neverCancelled(),
      });
      phasesObserved.push(catalogTurn.run.phase);
      expect(catalogTurn.run.phase).toBe('UNDERSTANDING');
      expect(
        catalogTurn.evidence.some((item) => item.toolId === 'inspect_verification_catalog'),
      ).toBe(true);
      expect(fileApply.calls).toBe(0);

      const verifyTurn = await agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'run_verification_command',
            intentId: 'p1d-verify-1',
            arguments: { commandId: 'npm-run-build' },
          },
        ],
        cancellation: neverCancelled(),
      });
      phasesObserved.push(verifyTurn.run.phase);
      expect(verifyTurn.run.phase).toBe('UNDERSTANDING');
      const verifyEvidence = verifyTurn.evidence.find(
        (item) => item.toolId === 'run_verification_command',
      );
      expect(verifyEvidence).toBeDefined();
      expect(verifyEvidence?.planningProjection).toBeUndefined();
      expect(fileApply.calls).toBe(0);

      const investigateTurn = await agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'search_repository',
            intentId: 'p1d-search-1',
            arguments: { query: 'integration' },
          },
        ],
        cancellation: neverCancelled(),
      });
      phasesObserved.push(investigateTurn.run.phase);
      const searchEvidence = investigateTurn.evidence.find(
        (item) => item.toolId === 'search_repository' && item.intentId === 'p1d-search-1',
      );
      expect(searchEvidence?.planningProjection?.pathHints).toContain('src/integration-output.ts');
      expect(fileApply.calls).toBe(0);
      expect(fileSystem.mutationCalls).toEqual([]);

      const operatorContextBeforePlan = buildOperatorToolPlanningContext(loop.listEvidence(runId));
      expect(
        operatorContextBeforePlan?.records.every(
          (record) => record.toolId !== 'run_verification_command',
        ),
      ).toBe(true);

      const planned = await agent.plan(runId);
      phasesObserved.push(planned.run.phase);
      expect(planned.run.phase).toBe('PLANNING');
      expect(fileApply.calls).toBe(0);
      expect(isOperatorToolPlanningMergeInput(capturedPrepareInputs.at(-1))).toBe(true);

      const paused = await agent.pauseAtGate2(runId);
      phasesObserved.push(paused.run.phase);
      expect(paused.run.phase).toBe('AWAITING_GATE2');
      expect(paused.run.status).toBe('AWAITING_GATE2');
      expect(fileApply.calls).toBe(0);

      await expect(agent.executeAfterApproval(runId, { approved: false })).rejects.toThrow(
        /Explicit approval is required/,
      );
      expect(fileApply.calls).toBe(0);

      const executed = await agent.executeAfterApproval(runId, { approved: true });
      expect('completion' in executed).toBe(true);
      if (!('completion' in executed)) throw new Error('expected completion');
      phasesObserved.push(executed.run.phase);
      expect(fileApply.calls).toBe(1);
      expect(executed.completion.verificationReport?.status).toBe('PASSED');

      const explained = await agent.explain(runId);
      phasesObserved.push(explained.run.phase);
      expect(explained.run.phase).toBe('COMPLETED');
      expect(explained.run.status).toBe('COMPLETED');

      const evidence: P1dBaselineVerificationProbeEvidence = {
        benchmarkId: P1D_BASELINE_VERIFICATION_PROBE_BENCHMARK_ID,
        runId,
        phasesObserved,
        fileApplyCallsBeforeApproval: 0,
        fileApplyCallsAfterApproval: fileApply.calls,
        baselineVerifyInUnderstanding: verifyEvidence?.phase === 'UNDERSTANDING',
        b4EvidenceWithoutPlanningProjection: verifyEvidence?.planningProjection === undefined,
        verificationStatus: explained.explain.verification.overallStatus ?? null,
        finalPhase: explained.run.phase,
        finalStatus: explained.run.status,
      };

      expect(evidence.phasesObserved).toEqual([
        'UNDERSTANDING',
        'UNDERSTANDING',
        'UNDERSTANDING',
        'UNDERSTANDING',
        'PLANNING',
        'AWAITING_GATE2',
        'VERIFYING',
        'COMPLETED',
      ]);
      expect(evidence.fileApplyCallsBeforeApproval).toBe(0);
      expect(evidence.fileApplyCallsAfterApproval).toBe(1);
      expect(evidence.baselineVerifyInUnderstanding).toBe(true);
      expect(evidence.b4EvidenceWithoutPlanningProjection).toBe(true);
      expect(evidence.verificationStatus).toBe('PASSED');
      expect(evidence.finalPhase).toBe('COMPLETED');
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
