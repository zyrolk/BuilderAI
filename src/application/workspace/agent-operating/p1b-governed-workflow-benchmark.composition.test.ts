/**
 * @vitest-environment node
 *
 * P1-B Option D — Repeatable governed workflow benchmark (composition only).
 * Measures the existing prepare → Gate2 → approveAndApply → FileApply → verify → correction
 * path without introducing a second workflow engine or new capability classes.
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentCompositionHarness } from './test/agent-operating.composition.fixture';

export const GOVERNED_WORKFLOW_BENCHMARK_ID = 'p1b-governed-workflow-v1' as const;

export interface GovernedWorkflowBenchmarkEvidence {
  readonly benchmarkId: typeof GOVERNED_WORKFLOW_BENCHMARK_ID;
  readonly runId: string;
  readonly phasesObserved: readonly string[];
  readonly fileApplyCalls: number;
  readonly gate2CyclesObserved: number;
  readonly verificationStatus: string | null;
  readonly correctionPathExercised: boolean;
  readonly finalPhase: string;
  readonly finalStatus: string;
  readonly mutationBeforeGate2Approval: boolean;
}

function assertNoMutationBeforeGate2(
  fileApplyCalls: number,
  mutationCalls: readonly string[],
): void {
  expect(fileApplyCalls).toBe(0);
  expect(mutationCalls).toEqual([]);
}

describe('P1-B governed workflow benchmark', () => {
  it('records happy-path evidence: prepare → Gate2 → apply → verify → COMPLETED', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1b-bench-happy-'));
    const runId = 'bench-happy-run';
    try {
      const harness = createAgentCompositionHarness({ stateRoot, runId });
      const { agent, fileApply, fileSystem } = harness;
      const phasesObserved: string[] = [];

      const started = await agent.startRun('Benchmark governed integration artifact.');
      phasesObserved.push(started.run.phase);
      assertNoMutationBeforeGate2(fileApply.calls, fileSystem.mutationCalls);

      const planned = await agent.plan(runId);
      phasesObserved.push(planned.run.phase);
      assertNoMutationBeforeGate2(fileApply.calls, fileSystem.mutationCalls);

      const paused = await agent.pauseAtGate2(runId);
      phasesObserved.push(paused.run.phase);
      assertNoMutationBeforeGate2(fileApply.calls, fileSystem.mutationCalls);

      const executed = await agent.executeAfterApproval(runId, { approved: true });
      expect('completion' in executed).toBe(true);
      if (!('completion' in executed)) throw new Error('expected completion');
      phasesObserved.push(executed.run.phase);
      expect(fileApply.calls).toBe(1);
      expect(fileSystem.mutationCalls.length).toBeGreaterThan(0);

      const explained = await agent.explain(runId);
      phasesObserved.push(explained.run.phase);

      const evidence: GovernedWorkflowBenchmarkEvidence = {
        benchmarkId: GOVERNED_WORKFLOW_BENCHMARK_ID,
        runId,
        phasesObserved,
        fileApplyCalls: fileApply.calls,
        gate2CyclesObserved: explained.explain.approvals.gate2CyclesObserved ?? 0,
        verificationStatus: explained.explain.verification.overallStatus ?? null,
        correctionPathExercised: false,
        finalPhase: explained.run.phase,
        finalStatus: explained.run.status,
        mutationBeforeGate2Approval: false,
      };

      expect(evidence.phasesObserved).toEqual([
        'UNDERSTANDING',
        'PLANNING',
        'AWAITING_GATE2',
        'VERIFYING',
        'COMPLETED',
      ]);
      expect(evidence.fileApplyCalls).toBe(1);
      expect(evidence.gate2CyclesObserved).toBe(1);
      expect(evidence.verificationStatus).toBe('PASSED');
      expect(evidence.finalPhase).toBe('COMPLETED');
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });

  it('records correction-path evidence: verify fail → correction → fresh Gate2 → re-apply', async () => {
    const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1b-bench-correct-'));
    const runId = 'bench-correct-run';
    try {
      const harness = createAgentCompositionHarness({
        stateRoot,
        runId,
        failedVerification: true,
        correctionUpdateOnSecondPrepare: true,
      });
      const { agent, fileApply, correction } = harness;
      const phasesObserved: string[] = [];

      await agent.startRun('Benchmark correction workflow.');
      const planned = await agent.plan(runId);
      phasesObserved.push(planned.run.phase);
      await agent.pauseAtGate2(runId);
      phasesObserved.push('AWAITING_GATE2');

      const failed = await agent.executeAfterApproval(runId, { approved: true });
      expect('correctionWorkflowId' in failed).toBe(true);
      if (!('correctionWorkflowId' in failed)) throw new Error('expected correction');
      phasesObserved.push(failed.run.phase);
      expect(fileApply.calls).toBe(1);

      const correctionPlan = await agent.plan(runId);
      expect(correctionPlan.run.phase).toBe('CORRECTING');
      await agent.pauseAtGate2(runId);
      phasesObserved.push('AWAITING_GATE2');

      const recovered = await agent.executeAfterApproval(runId, { approved: true });
      expect('completion' in recovered).toBe(true);
      if (!('completion' in recovered)) throw new Error('expected recovery');
      phasesObserved.push(recovered.run.phase);

      const explained = await agent.explain(runId);
      phasesObserved.push(explained.run.phase);

      const evidence: GovernedWorkflowBenchmarkEvidence = {
        benchmarkId: GOVERNED_WORKFLOW_BENCHMARK_ID,
        runId,
        phasesObserved,
        fileApplyCalls: fileApply.calls,
        gate2CyclesObserved: explained.explain.approvals.gate2CyclesObserved ?? 0,
        verificationStatus: explained.explain.verification.overallStatus ?? null,
        correctionPathExercised: true,
        finalPhase: explained.run.phase,
        finalStatus: explained.run.status,
        mutationBeforeGate2Approval: false,
      };

      expect(evidence.fileApplyCalls).toBe(2);
      expect(evidence.gate2CyclesObserved).toBe(2);
      expect(evidence.verificationStatus).toBe('PASSED');
      expect(evidence.finalPhase).toBe('COMPLETED');
      expect(correction.getSession(failed.correctionWorkflowId)?.state).toBe('CORRECTION_PASSED');
      expect(evidence.phasesObserved.filter((phase) => phase === 'AWAITING_GATE2')).toHaveLength(2);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
  });
});
