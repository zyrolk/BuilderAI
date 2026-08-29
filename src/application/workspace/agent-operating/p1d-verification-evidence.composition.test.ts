/**
 * @vitest-environment node
 *
 * P1-D Slice 2 — Bounded structured verification evidence persist/reload/planning isolation (ADR-050).
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
import { AGENT_LOOP_SCHEMA_VERSION } from '../agent-loop/agent-loop.types';
import { toBoundedToolEvidenceHttpView } from '../../../app/api/workspace/agent/agent-route-helpers';
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
  readonly persistence: AgentLoopEvidencePersistence;
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
        throw new Error('prepareFromResponsePackage unused in P1-D Slice 2');
      },
    },
    clock: { now: () => new Date('2026-08-29T15:00:00.000Z') },
    ids: {
      generate: () => {
        idSeq += 1;
        return `p1d2-${String(idSeq).padStart(4, '0')}`;
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
    clock: { now: () => new Date('2026-08-29T15:00:00.000Z') },
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
    clock: { now: () => new Date('2026-08-29T15:00:00.000Z') },
    loop: composed.loop,
    projectRoot,
    security: {
      profile: 'TRUSTED_LOCAL',
      projectId,
      principalId: 'local-operator',
    },
  });

  return {
    agent,
    loop: composed.loop,
    capturedPrepareInputs,
    persistence: loopPersistence,
  };
}

describe('P1-D Slice 2 verification evidence composition (ADR-050)', () => {
  it('persists structured verification evidence across reload and ignores it at plan', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1d2-'));
    const runId = 'run-p1d2-evidence';
    const projectRoot = ZYRO_STYLE_FIXTURE_ROOT;
    try {
      const harness = createAgentCompositionHarness({ stateRoot, runId });
      const { agent, loop, capturedPrepareInputs, persistence } = composeAgentWithLoop(
        harness,
        stateRoot,
        runId,
        projectRoot,
      );

      const started = await agent.startRun(
        'Review structured verification evidence before planning.',
      );
      expect(started.run.phase).toBe('UNDERSTANDING');
      expect(harness.fileApply.calls).toBe(0);

      const verifyTurn = await agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'run_verification_command',
            intentId: 'p1d2-verify-1',
            arguments: { commandId: 'npm-run-build' },
          },
        ],
        cancellation: neverCancelled(),
      });
      expect(verifyTurn.run.phase).toBe('UNDERSTANDING');
      const verifyEvidence = verifyTurn.evidence.find(
        (item) => item.toolId === 'run_verification_command',
      );
      // Zyro fixture build passes under allowlisted env (BUILDERAI_VERIFY_MODE is not forwarded).
      // FAILED path is covered by extractor unit tests + stubbed AgentLoop persistence below.
      expect(verifyEvidence?.verificationEvidence).toEqual(
        expect.objectContaining({
          commandId: 'npm-run-build',
          stage: 'BUILD_VALIDATION',
          executionStatus: 'SUCCEEDED',
          exitCode: 0,
        }),
      );
      expect(verifyEvidence?.planningProjection).toBeUndefined();
      expect(JSON.stringify(verifyEvidence?.verificationEvidence)).not.toContain(
        'diagnosticSummary',
      );
      expect(harness.fileApply.calls).toBe(0);

      const reloaded = await persistence.load(runId);
      expect(reloaded?.schemaVersion).toBe(AGENT_LOOP_SCHEMA_VERSION);
      expect(
        reloaded?.evidence.find((item) => item.intentId === 'p1d2-verify-1')?.verificationEvidence,
      ).toEqual(
        expect.objectContaining({
          commandId: 'npm-run-build',
          executionStatus: 'SUCCEEDED',
          exitCode: 0,
        }),
      );

      const httpView = toBoundedToolEvidenceHttpView(
        reloaded!.evidence.find((item) => item.intentId === 'p1d2-verify-1')!,
      );
      expect(httpView.verificationEvidence).toEqual(
        expect.objectContaining({
          commandId: 'npm-run-build',
          executionStatus: 'SUCCEEDED',
          exitCode: 0,
          timedOut: false,
          cancelled: false,
          policyBlocked: false,
          outputLimited: expect.any(Boolean),
        }),
      );
      expect(httpView).not.toHaveProperty('diagnosticSummary');
      expect(JSON.stringify(httpView)).not.toContain('stdout');
      expect(JSON.stringify(httpView)).not.toContain('stderr');

      const operatorContext = buildOperatorToolPlanningContext(loop.listEvidence(runId));
      expect(
        operatorContext?.records.every((record) => record.toolId !== 'run_verification_command') ??
          true,
      ).toBe(true);

      await agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'search_repository',
            intentId: 'p1d2-search-1',
            arguments: { query: 'integration' },
          },
        ],
        cancellation: neverCancelled(),
      });

      const planned = await agent.plan(runId);
      expect(planned.run.phase).toBe('PLANNING');
      expect(harness.fileApply.calls).toBe(0);
      expect(isOperatorToolPlanningMergeInput(capturedPrepareInputs.at(-1))).toBe(true);
      expect(JSON.stringify(capturedPrepareInputs.at(-1))).not.toContain('verificationEvidence');
      expect(JSON.stringify(capturedPrepareInputs.at(-1))).not.toContain('npm-run-build');
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
