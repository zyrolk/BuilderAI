/**
 * @vitest-environment node
 *
 * P1-C Slice 2 — Context → Plan Quality (composition only).
 * Proves: operator B1/B2 investigation persists bounded planning projection, hydrates after reload,
 * merges into server-side prepare context, and reaches Gate2 with zero FileApply before approval.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ChangePlannerService } from '../../../core/change-planner';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { InMemoryAppliedFileApplyBindingStore } from '../controlled-git/applied-file-apply-binding.port';
import { ControlledTerminalService } from '../controlled-terminal/controlled-terminal.service';
import { EditProposalService } from '../edit-proposal/edit-proposal.service';
import type { ExternalTargetReadiness } from '../external-target-readiness/external-target-readiness.types';
import { buildInvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { createControlledGitService } from '../tool-registry/create-b5-git-registry';
import { createControlledLocalBrowserService } from '../tool-registry/create-b7-browser-registry';
import { createAgentLoopComposition } from '../agent-loop';
import { AgentLoopEvidencePersistence } from '../agent-loop/agent-loop.persistence';
import { AgentOperatingService } from './agent-operating.service';
import {
  createAgentCompositionHarness,
  type AgentCompositionHarness,
} from './test/agent-operating.composition.fixture';
import { isOperatorToolPlanningMergeInput } from './operator-tool-planning-prepare-input';
import type {
  AgentOperatingInvestigationPort,
  AgentOperatingRuntimePort,
} from './agent-operating.types';
import type { AgentLoopService } from '../agent-loop/agent-loop.service';

export const CONTEXT_TO_PLAN_QUALITY_BENCHMARK_ID = 'p1c-context-to-plan-quality-v1' as const;
export const P1C_CLOSURE_BENCHMARK_ID = 'p1c-closure-v1' as const;

export interface P1cClosureBenchmarkEvidence {
  readonly benchmarkId: typeof P1C_CLOSURE_BENCHMARK_ID;
  readonly runId: string;
  readonly phasesObserved: readonly string[];
  readonly fileApplyCallsBeforeApproval: number;
  readonly fileApplyCallsAfterApproval: number;
  readonly operatorPathInProvenance: boolean;
  readonly plannedPathOverlapCount: number;
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
    projectName: 'BuilderAI',
    projectRootDisplay: '.',
    runtimeConnected: true,
    sourceRoots: ['src'],
    testRoots: [],
    governanceDocuments: [],
    indexedFileCount: 1,
    protectedAreas: [],
    verification: {
      build: true,
      test: true,
      lint: false,
      typecheck: false,
      format: false,
      devServer: false,
      browserVerification: false,
    },
    warnings: [],
    blockers: [],
  };
}

function createInvestigationWithEmptyPaths(): AgentOperatingInvestigationPort {
  const investigationId = 'inv-p1c-s2';
  return {
    investigate: async (request) =>
      ({
        investigationId,
        request,
        report: {
          schemaVersion: 1,
          investigationId,
          summary: 'P1-C Slice 2 investigation',
          confidence: 'MEDIUM',
          hypotheses: [],
          evidence: [],
          affectedAreas: [],
          recommendedNextSteps: ['prepare'],
          limitations: [],
        },
        searchResult: { schemaVersion: 1, matches: [], queries: [], truncated: false },
        repositorySourcePaths: ['src/integration-output.ts'],
        bounded: true,
      }) as never,
    resolveInvestigationHandoff: () =>
      buildInvestigationHandoffFeedback({
        sourceInvestigationId: investigationId,
        priorRequestSummary: 'Improve integration output.',
        investigationSummary: 'P0 baseline without operator paths.',
        sourcePaths: [],
        requestText: 'integration output',
        queries: ['integration'],
        evidence: [],
        searchMatches: [],
        hypotheses: [],
        affectedAreas: [],
      }),
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
        throw new Error('prepareFromResponsePackage unused in P1-C Slice 2 benchmark');
      },
    },
    clock: { now: () => new Date('2026-08-28T12:00:00.000Z') },
    ids: {
      generate: () => {
        idSeq += 1;
        return `p1c2-${String(idSeq).padStart(4, '0')}`;
      },
    },
    expectedBaselineDigest: 'b',
    readBaselineDigest: async () => 'b',
  });
  const controlledTerminal = new ControlledTerminalService({
    createRunner: () => ({
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        policyBlocked: false,
        stdout: '',
        stderr: '',
        stdoutLimited: false,
        stderrLimited: false,
        outputLimited: false,
      }),
    }),
    discoverScripts: () => ({
      hasBuild: true,
      hasTest: true,
      lintScript: undefined,
      typecheckScript: undefined,
      formatScript: undefined,
    }),
  });
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
    clock: { now: () => new Date('2026-08-28T12:00:00.000Z') },
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
    investigation: createInvestigationWithEmptyPaths(),
    runtime,
    correction: harness.correction,
    ids: { generate: () => runId },
    clock: { now: () => new Date('2026-08-21T15:00:00.000Z') },
    loop: composed.loop,
    projectRoot: process.cwd(),
    security: {
      profile: 'TRUSTED_LOCAL',
      projectId,
      principalId: 'local-operator',
    },
  });

  return { agent, loop: composed.loop, capturedPrepareInputs };
}

describe('P1-C context to plan quality benchmark', () => {
  it('persists projection, hydrates, merges operator paths into prepare, and pauses at Gate2', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1c2-quality-'));
    const runId = 'p1c2-quality-run';
    try {
      const harness = createAgentCompositionHarness({ stateRoot, runId });
      const first = composeAgentWithLoop(harness, stateRoot, runId);

      await first.agent.startRun('Benchmark context-to-plan-quality artifact.');

      const turn = await first.agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'search_repository',
            intentId: 'p1c2-intent-1',
            arguments: { query: 'integration' },
          },
        ],
        cancellation: neverCancelled(),
      });
      expect(turn.evidence[0]?.planningProjection?.pathHints).toContain(
        'src/integration-output.ts',
      );
      expect(harness.fileApply.calls).toBe(0);

      // Simulate process restart: new AgentOperatingService + fresh in-memory loop cache.
      const reloaded = composeAgentWithLoop(harness, stateRoot, runId);
      await reloaded.loop.hydrate(runId);
      const hydratedEvidence = reloaded.loop.listEvidence(runId);
      expect(hydratedEvidence[0]?.planningProjection?.pathHints).toContain(
        'src/integration-output.ts',
      );

      const planned = await reloaded.agent.plan(runId);
      expect(planned.run.phase).toBe('PLANNING');
      expect(harness.fileApply.calls).toBe(0);
      expect(planned.planningProvenance).toBeDefined();
      expect(planned.planningProvenance?.hasOperatorContext).toBe(true);
      expect(planned.planningProvenance?.operatorPathHintCount).toBeGreaterThan(0);
      expect(
        planned.planningProvenance?.operatorOnlyPathHints.includes('src/integration-output.ts') ||
          planned.planningProvenance?.mergedPathHints.includes('src/integration-output.ts'),
      ).toBe(true);

      const mergeInput = reloaded.capturedPrepareInputs.at(-1);
      expect(isOperatorToolPlanningMergeInput(mergeInput)).toBe(true);
      if (isOperatorToolPlanningMergeInput(mergeInput)) {
        expect(mergeInput.mergedHandoff.pathHints).toContain('src/integration-output.ts');
        expect(mergeInput.mergedHandoff.investigationSummary).toContain(
          'Operator tool investigation (read-only; not applied)',
        );
        expect(mergeInput.mergedHandoff.investigationSummary).toContain(
          'P0 baseline without operator paths.',
        );
      }

      const paused = await reloaded.agent.pauseAtGate2(runId);
      expect(paused.run.phase).toBe('AWAITING_GATE2');
      expect(harness.fileApply.calls).toBe(0);
      expect(paused.planningProvenance).toBeDefined();
      expect(paused.planningProvenance?.plannedOperationCount).toBeGreaterThan(0);
      expect(paused.planningProvenance?.plannedPathOverlapCount).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('records full P1-C closure: investigate → provenance → approve → apply → verify → explain', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1c-closure-'));
    const runId = 'p1c-closure-run';
    try {
      const harness = createAgentCompositionHarness({ stateRoot, runId });
      const { agent, loop, capturedPrepareInputs } = composeAgentWithLoop(
        harness,
        stateRoot,
        runId,
      );
      const { fileApply, fileSystem } = harness;
      const phasesObserved: string[] = [];

      const started = await agent.startRun('P1-C closure benchmark governed lifecycle.');
      phasesObserved.push(started.run.phase);
      expect(started.run.phase).toBe('UNDERSTANDING');
      expect(fileApply.calls).toBe(0);

      const turn = await agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'search_repository',
            intentId: 'p1c-closure-intent-1',
            arguments: { query: 'integration' },
          },
        ],
        cancellation: neverCancelled(),
      });
      phasesObserved.push(turn.run.phase);
      expect(turn.run.phase).toBe('UNDERSTANDING');
      expect(turn.evidence[0]?.planningProjection?.pathHints).toContain(
        'src/integration-output.ts',
      );
      expect(fileApply.calls).toBe(0);
      expect(fileSystem.mutationCalls).toEqual([]);

      const planned = await agent.plan(runId);
      phasesObserved.push(planned.run.phase);
      expect(planned.run.phase).toBe('PLANNING');
      expect(fileApply.calls).toBe(0);
      expect(planned.planningProvenance).toBeDefined();
      expect(planned.planningProvenance?.hasOperatorContext).toBe(true);
      expect(isOperatorToolPlanningMergeInput(capturedPrepareInputs.at(-1))).toBe(true);

      const paused = await agent.pauseAtGate2(runId);
      phasesObserved.push(paused.run.phase);
      expect(paused.run.phase).toBe('AWAITING_GATE2');
      expect(paused.run.status).toBe('AWAITING_GATE2');
      expect(fileApply.calls).toBe(0);

      const provenance = paused.planningProvenance;
      expect(provenance).toBeDefined();
      expect(provenance?.mergedPathHints).toContain('src/integration-output.ts');
      expect(provenance?.plannedPathOverlapCount).toBeGreaterThanOrEqual(1);
      expect(provenance?.matchedPlannedPaths).toContain('src/integration-output.ts');

      await expect(agent.executeAfterApproval(runId, { approved: false })).rejects.toThrow(
        /Explicit approval is required/,
      );
      expect(fileApply.calls).toBe(0);

      const executed = await agent.executeAfterApproval(runId, { approved: true });
      expect('completion' in executed).toBe(true);
      if (!('completion' in executed)) throw new Error('expected completion');
      phasesObserved.push(executed.run.phase);
      expect(fileApply.calls).toBe(1);
      expect(fileSystem.mutationCalls.length).toBeGreaterThan(0);
      expect(executed.completion.verificationReport?.status).toBe('PASSED');

      const explained = await agent.explain(runId);
      phasesObserved.push(explained.run.phase);
      expect(explained.run.phase).toBe('COMPLETED');
      expect(explained.run.status).toBe('COMPLETED');
      expect(explained.explain.verification.overallStatus).toBe('PASSED');
      expect(explained.explain.toolLoop.evidenceCount).toBeGreaterThan(0);

      const fileApplyCallsBeforeApproval = 0;
      const evidence: P1cClosureBenchmarkEvidence = {
        benchmarkId: P1C_CLOSURE_BENCHMARK_ID,
        runId,
        phasesObserved,
        fileApplyCallsBeforeApproval,
        fileApplyCallsAfterApproval: fileApply.calls,
        operatorPathInProvenance:
          provenance?.mergedPathHints.includes('src/integration-output.ts') ?? false,
        plannedPathOverlapCount: provenance?.plannedPathOverlapCount ?? 0,
        verificationStatus: explained.explain.verification.overallStatus ?? null,
        finalPhase: explained.run.phase,
        finalStatus: explained.run.status,
      };

      expect(evidence.phasesObserved).toEqual([
        'UNDERSTANDING',
        'UNDERSTANDING',
        'PLANNING',
        'AWAITING_GATE2',
        'VERIFYING',
        'COMPLETED',
      ]);
      expect(evidence.fileApplyCallsBeforeApproval).toBe(0);
      expect(evidence.fileApplyCallsAfterApproval).toBe(1);
      expect(evidence.operatorPathInProvenance).toBe(true);
      expect(evidence.plannedPathOverlapCount).toBeGreaterThanOrEqual(1);
      expect(evidence.verificationStatus).toBe('PASSED');
      expect(evidence.finalPhase).toBe('COMPLETED');

      await loop.hydrate(runId);
      expect(loop.listEvidence(runId)[0]?.planningProjection?.pathHints).toContain(
        'src/integration-output.ts',
      );
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
