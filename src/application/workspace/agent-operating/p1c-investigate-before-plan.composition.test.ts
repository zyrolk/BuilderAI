/**
 * @vitest-environment node
 *
 * P1-C Slice 1 — Investigate before plan (composition only).
 * Proves: start → investigate → bounded evidence → explicit plan → Gate2 with zero FileApply
 * before Gate2 approval. Reuses frozen B8 AgentLoop + existing AgentOperating plan path.
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
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { createControlledGitService } from '../tool-registry/create-b5-git-registry';
import { createControlledLocalBrowserService } from '../tool-registry/create-b7-browser-registry';
import { createAgentLoopComposition } from '../agent-loop';
import { AgentLoopEvidencePersistence } from '../agent-loop/agent-loop.persistence';
import { AgentOperatingService } from './agent-operating.service';
import {
  createAgentCompositionHarness,
  createStubInvestigation,
  type AgentCompositionHarness,
} from './test/agent-operating.composition.fixture';

export const INVESTIGATE_BEFORE_PLAN_BENCHMARK_ID = 'p1c-investigate-before-plan-v1' as const;

export interface InvestigateBeforePlanBenchmarkEvidence {
  readonly benchmarkId: typeof INVESTIGATE_BEFORE_PLAN_BENCHMARK_ID;
  readonly runId: string;
  readonly phasesObserved: readonly string[];
  readonly toolEvidenceCount: number;
  readonly fileApplyCalls: number;
  readonly mutationBeforeGate2Approval: boolean;
  readonly awaitingGate2AfterPlan: boolean;
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

function assertNoMutationBeforeGate2(
  fileApplyCalls: number,
  mutationCalls: readonly string[],
): void {
  expect(fileApplyCalls).toBe(0);
  expect(mutationCalls).toEqual([]);
}

function composeAgentWithLoop(
  harness: AgentCompositionHarness,
  stateRoot: string,
): AgentOperatingService {
  const projectId = 'builder-ai';
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
        throw new Error('prepareFromResponsePackage unused in P1-C benchmark');
      },
    },
    clock: { now: () => new Date('2026-08-23T12:00:00.000Z') },
    ids: {
      generate: () => {
        idSeq += 1;
        return `p1c-${String(idSeq).padStart(4, '0')}`;
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
    clock: { now: () => new Date('2026-08-23T12:00:00.000Z') },
  });

  return new AgentOperatingService({
    projectId,
    agentRuns: harness.agentRuns,
    explainArtifacts: harness.explainArtifacts,
    investigation: createStubInvestigation(),
    runtime: harness.runtime,
    correction: harness.correction,
    ids: { generate: () => 'p1c-investigate-run' },
    clock: { now: () => new Date('2026-08-21T15:00:00.000Z') },
    loop: composed.loop,
    projectRoot: process.cwd(),
    security: {
      profile: 'TRUSTED_LOCAL',
      projectId,
      principalId: 'local-operator',
    },
  });
}

describe('P1-C investigate before plan benchmark', () => {
  it('records start → investigate → bounded evidence → explicit plan → Gate2 with zero FileApply before approval', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1c-investigate-'));
    const runId = 'p1c-investigate-run';
    try {
      const harness = createAgentCompositionHarness({ stateRoot, runId });
      const agent = composeAgentWithLoop(harness, stateRoot);
      const { fileApply, fileSystem } = harness;
      const phasesObserved: string[] = [];

      const started = await agent.startRun('Benchmark investigate-before-plan artifact.');
      phasesObserved.push(started.run.phase);
      expect(started.run.phase).toBe('UNDERSTANDING');
      assertNoMutationBeforeGate2(fileApply.calls, fileSystem.mutationCalls);

      const turn = await agent.executeToolTurn(runId, {
        intents: [
          {
            toolId: 'search_repository',
            intentId: 'p1c-intent-1',
            arguments: { query: 'integration' },
          },
        ],
        cancellation: neverCancelled(),
      });
      phasesObserved.push(turn.run.phase);
      expect(turn.run.phase).toBe('UNDERSTANDING');
      expect(turn.evidence.length).toBeGreaterThan(0);
      expect(turn.evidence[0]?.summaryDigest.length).toBeGreaterThan(0);
      assertNoMutationBeforeGate2(fileApply.calls, fileSystem.mutationCalls);

      const toolEvidence = await agent.getToolEvidence(runId);
      expect(toolEvidence.evidence.length).toBeGreaterThan(0);

      const planned = await agent.plan(runId);
      phasesObserved.push(planned.run.phase);
      assertNoMutationBeforeGate2(fileApply.calls, fileSystem.mutationCalls);

      const paused = await agent.pauseAtGate2(runId);
      phasesObserved.push(paused.run.phase);
      expect(paused.run.phase).toBe('AWAITING_GATE2');
      expect(paused.run.status).toBe('AWAITING_GATE2');
      assertNoMutationBeforeGate2(fileApply.calls, fileSystem.mutationCalls);

      const evidence: InvestigateBeforePlanBenchmarkEvidence = {
        benchmarkId: INVESTIGATE_BEFORE_PLAN_BENCHMARK_ID,
        runId,
        phasesObserved,
        toolEvidenceCount: toolEvidence.evidence.length,
        fileApplyCalls: fileApply.calls,
        mutationBeforeGate2Approval: false,
        awaitingGate2AfterPlan: paused.run.phase === 'AWAITING_GATE2',
      };

      expect(evidence.phasesObserved).toEqual([
        'UNDERSTANDING',
        'UNDERSTANDING',
        'PLANNING',
        'AWAITING_GATE2',
      ]);
      expect(evidence.toolEvidenceCount).toBeGreaterThan(0);
      expect(evidence.fileApplyCalls).toBe(0);
      expect(evidence.awaitingGate2AfterPlan).toBe(true);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
