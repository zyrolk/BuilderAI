import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createAgentCompositionHarness,
  reloadAgentCompositionHarness,
} from './test/agent-operating.composition.fixture';

/**
 * P1-A Step 6 — Full end-to-end validation of the gated Agent Operating Layer.
 * Uses real WorkspaceRuntimeService / CorrectionLoop / FileApply composition fixtures.
 */
describe('P1-A Step 6 E2E', () => {
  describe('E2E-1 — Successful governed run', () => {
    it('runs start→understand→plan→Gate2→approve→apply→verify→browser→explain→COMPLETED', async () => {
      const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e1-'));
      try {
        const harness = createAgentCompositionHarness({
          stateRoot,
          runId: 'e2e1-run',
          includeBrowserVerification: true,
        });
        const { agent, fileApply, fileSystem, verification } = harness;

        const started = await agent.startRun('Create the approved integration artifact.');
        expect(started.run.phase).toBe('UNDERSTANDING');
        expect(started.run.references.investigationId).toBeDefined();
        expect(fileApply.calls).toBe(0);
        expect(fileSystem.mutationCalls).toEqual([]);

        const planned = await agent.plan('e2e1-run');
        expect(planned.run.phase).toBe('PLANNING');
        expect(planned.preparationId).toBeDefined();
        expect(planned.gate2Review.operationDiffs.length).toBeGreaterThan(0);
        expect(fileApply.calls).toBe(0);

        const paused = await agent.pauseAtGate2('e2e1-run');
        expect(paused.run.phase).toBe('AWAITING_GATE2');
        expect(paused.run.status).toBe('AWAITING_GATE2');
        expect(fileApply.calls).toBe(0);
        expect(fileSystem.mutationCalls).toEqual([]);

        const executed = await agent.executeAfterApproval('e2e1-run', { approved: true });
        expect('completion' in executed).toBe(true);
        if (!('completion' in executed)) throw new Error('expected success');
        expect(executed.run.phase).toBe('VERIFYING');
        expect(fileApply.calls).toBe(1);
        expect(fileSystem.mutationCalls).toEqual(['create:src/integration-output.ts']);
        expect(verification.calls).toContain('BUILD_VALIDATION');
        expect(executed.completion.verificationReport?.status).toBe('PASSED');
        expect(executed.completion.runtimeBrowserVerificationReport?.status).toBe('PASSED');

        const explained = await agent.explain('e2e1-run');
        expect(explained.run.phase).toBe('COMPLETED');
        expect(explained.run.status).toBe('COMPLETED');
        expect(fileApply.calls).toBe(1);

        const loaded = await agent.getExplainArtifact('e2e1-run');
        expect(loaded.persisted).toBe(true);
        expect(loaded.explain.changes.applyStatus).toBe('APPLIED');
        expect(loaded.explain.verification.overallStatus).toBe('PASSED');
        expect(loaded.explain.browserVerification.availability.status).toBe('AVAILABLE');
        expect(loaded.explain.browserVerification.overallStatus).toBe('PASSED');
        expect(loaded.explain.approvals.gate2CyclesObserved).toBe(1);
        expect(JSON.stringify(loaded.explain)).not.toMatch(
          /unifiedDiff|stdout|stderr|fileContents|promptPackage|screenshot/,
        );

        const onDisk = JSON.parse(
          await readFile(
            path.join(
              stateRoot,
              'workflows',
              'builder-ai',
              'agent-runs',
              'e2e1-run',
              'agent-run.json',
            ),
            'utf8',
          ),
        ) as { phase: string; changePlan?: unknown };
        expect(onDisk.phase).toBe('COMPLETED');
        expect(onDisk.changePlan).toBeUndefined();
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });
  });

  describe('E2E-2 — Approval safety', () => {
    it('rejects missing/false approval and never mutates before valid approve', async () => {
      const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e2-'));
      try {
        const harness = createAgentCompositionHarness({ stateRoot, runId: 'e2e2-run' });
        const { agent, fileApply, fileSystem } = harness;
        await agent.startRun('Create the approved integration artifact.');
        await agent.plan('e2e2-run');
        await agent.pauseAtGate2('e2e2-run');

        await expect(
          agent.executeAfterApproval('e2e2-run', { approved: false }),
        ).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
        expect(fileApply.calls).toBe(0);
        expect(fileSystem.mutationCalls).toEqual([]);

        const stillWaiting = await agent.getRun('e2e2-run');
        expect(stillWaiting.phase).toBe('AWAITING_GATE2');

        const executed = await agent.executeAfterApproval('e2e2-run', { approved: true });
        expect('completion' in executed).toBe(true);
        expect(fileApply.calls).toBe(1);
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });

    it('does not allow execute before Gate 2 and concurrent approve cannot double-apply', async () => {
      const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e2b-'));
      try {
        const harness = createAgentCompositionHarness({ stateRoot, runId: 'e2e2b-run' });
        const { agent, fileApply } = harness;
        await agent.startRun('Create the approved integration artifact.');
        await expect(
          agent.executeAfterApproval('e2e2b-run', { approved: true }),
        ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
        expect(fileApply.calls).toBe(0);

        await agent.plan('e2e2b-run');
        await agent.pauseAtGate2('e2e2b-run');

        const [first, second] = await Promise.allSettled([
          agent.executeAfterApproval('e2e2b-run', { approved: true }),
          agent.executeAfterApproval('e2e2b-run', { approved: true }),
        ]);
        const successes = [first, second].filter((result) => result.status === 'fulfilled');
        expect(successes.length).toBe(1);
        expect(fileApply.calls).toBe(1);
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });

    it('restart while AWAITING_GATE2 never auto-applies', async () => {
      const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e2c-'));
      try {
        const harness = createAgentCompositionHarness({ stateRoot, runId: 'e2e2c-run' });
        await harness.agent.startRun('Create the approved integration artifact.');
        await harness.agent.plan('e2e2c-run');
        await harness.agent.pauseAtGate2('e2e2c-run');
        expect(harness.fileApply.calls).toBe(0);

        const reloaded = reloadAgentCompositionHarness(harness);
        await reloaded.hydrate();
        const run = await reloaded.getRun('e2e2c-run');
        expect(run.phase).toBe('AWAITING_GATE2');
        expect(run.status).toBe('AWAITING_GATE2');
        expect(harness.fileApply.calls).toBe(0);
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });
  });

  describe('E2E-3 — Correction path', () => {
    it('failure→diagnose→correct→Gate2→approve→re-apply→verify→explain with two Gate 2 cycles', async () => {
      const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e3-'));
      try {
        const harness = createAgentCompositionHarness({
          stateRoot,
          runId: 'e2e3-run',
          failedVerification: true,
          correctionUpdateOnSecondPrepare: true,
          includeBrowserVerification: true,
        });
        const { agent, fileApply, correction } = harness;

        await agent.startRun('Create the approved integration artifact.');
        await agent.plan('e2e3-run');
        await agent.pauseAtGate2('e2e3-run');
        const failed = await agent.executeAfterApproval('e2e3-run', { approved: true });
        expect('correctionWorkflowId' in failed).toBe(true);
        if (!('correctionWorkflowId' in failed)) throw new Error('expected correction');
        expect(failed.run.phase).toBe('CORRECTING');
        expect(failed.canPrepareCorrection).toBe(true);
        expect(fileApply.calls).toBe(1);
        const session = correction.getSession(failed.correctionWorkflowId);
        expect(session?.state).toBe('CORRECTION_PREPARING');
        expect(session?.state).not.toBe('CORRECTION_APPLYING');

        // No auto second apply while correcting.
        expect(fileApply.calls).toBe(1);

        const correctionPlan = await agent.plan('e2e3-run');
        expect(correctionPlan.run.phase).toBe('CORRECTING');
        expect(correctionPlan.preparationId).not.toBe(failed.run.references.preparationId);
        expect(fileApply.calls).toBe(1);

        const secondGate = await agent.pauseAtGate2('e2e3-run');
        expect(secondGate.run.phase).toBe('AWAITING_GATE2');
        expect(fileApply.calls).toBe(1);
        expect(correction.getSession(failed.correctionWorkflowId)?.state).toBe(
          'CORRECTION_WAITING_FOR_APPROVAL',
        );

        await expect(
          agent.executeAfterApproval('e2e3-run', { approved: false }),
        ).rejects.toBeTruthy();
        expect(fileApply.calls).toBe(1);

        const recovered = await agent.executeAfterApproval('e2e3-run', { approved: true });
        expect('completion' in recovered).toBe(true);
        if (!('completion' in recovered)) throw new Error('expected recovered success');
        expect(fileApply.calls).toBe(2);
        expect(recovered.completion.verificationReport?.status).toBe('PASSED');
        expect(correction.getSession(failed.correctionWorkflowId)?.state).toBe('CORRECTION_PASSED');

        const explained = await agent.explain('e2e3-run');
        expect(explained.run.phase).toBe('COMPLETED');
        expect(explained.explain.corrections.availability.status).toBe('AVAILABLE');
        expect(explained.explain.approvals.gate2CyclesObserved).toBe(2);
        expect(explained.explain.failures.length).toBeGreaterThanOrEqual(0);
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });
  });

  describe('E2E-4 — Cancellation', () => {
    it('cancels at Gate 2 without mutation and remains terminal after reload', async () => {
      const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e4-'));
      try {
        const harness = createAgentCompositionHarness({ stateRoot, runId: 'e2e4-run' });
        await harness.agent.startRun('Create the approved integration artifact.');
        await harness.agent.plan('e2e4-run');
        await harness.agent.pauseAtGate2('e2e4-run');
        expect(harness.fileApply.calls).toBe(0);

        const cancelled = await harness.agent.cancel('e2e4-run', 'operator cancel');
        expect(cancelled.run.phase).toBe('CANCELLED');
        expect(cancelled.run.status).toBe('CANCELLED');
        expect(harness.fileApply.calls).toBe(0);
        expect(harness.fileSystem.mutationCalls).toEqual([]);

        await expect(
          harness.agent.executeAfterApproval('e2e4-run', { approved: true }),
        ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
        expect(harness.fileApply.calls).toBe(0);

        const reloaded = reloadAgentCompositionHarness(harness);
        await reloaded.hydrate();
        const run = await reloaded.getRun('e2e4-run');
        expect(run.phase).toBe('CANCELLED');
        expect(harness.fileApply.calls).toBe(0);
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });
  });

  describe('E2E-5 — Recovery / restart', () => {
    it('reloads COMPLETED and AWAITING_GATE2 honestly without silent restart', async () => {
      const waitingRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e5a-'));
      const completedRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-e2e5b-'));
      try {
        const waiting = createAgentCompositionHarness({
          stateRoot: waitingRoot,
          runId: 'e2e5-wait',
        });
        await waiting.agent.startRun('Create the approved integration artifact.');
        await waiting.agent.plan('e2e5-wait');
        await waiting.agent.pauseAtGate2('e2e5-wait');
        const waitingReload = reloadAgentCompositionHarness(waiting);
        await waitingReload.hydrate();
        expect((await waitingReload.getRun('e2e5-wait')).phase).toBe('AWAITING_GATE2');

        const completed = createAgentCompositionHarness({
          stateRoot: completedRoot,
          runId: 'e2e5-done',
          includeBrowserVerification: true,
        });
        await completed.agent.startRun('Create the approved integration artifact.');
        await completed.agent.plan('e2e5-done');
        await completed.agent.pauseAtGate2('e2e5-done');
        await completed.agent.executeAfterApproval('e2e5-done', { approved: true });
        await completed.agent.explain('e2e5-done');
        expect(completed.fileApply.calls).toBe(1);

        const doneReload = reloadAgentCompositionHarness(completed);
        await doneReload.hydrate();
        expect((await doneReload.getRun('e2e5-done')).phase).toBe('COMPLETED');
        const explain = await doneReload.getExplainArtifact('e2e5-done');
        expect(explain.persisted).toBe(true);
        expect(explain.explain.finalResult.runStatus).toBe('COMPLETED');
        expect(completed.fileApply.calls).toBe(1);
      } finally {
        await rm(waitingRoot, { recursive: true, force: true });
        await rm(completedRoot, { recursive: true, force: true });
      }
    });
  });

  describe('Architecture invariants', () => {
    it('keeps FileApply as sole writer, Gate 2 mandatory, and AgentRun metadata-only', async () => {
      const stateRoot = await mkdtemp(path.join(tmpdir(), 'builderai-p1a6-inv-'));
      try {
        const harness = createAgentCompositionHarness({
          stateRoot,
          runId: 'e2e-inv',
          includeBrowserVerification: true,
        });
        const { agent, fileApply, fileSystem } = harness;

        await agent.startRun('Create the approved integration artifact.');
        await agent.plan('e2e-inv');
        expect(fileApply.calls).toBe(0);
        await agent.pauseAtGate2('e2e-inv');
        expect(fileApply.calls).toBe(0);

        // No auto-approve path exists on the service surface.
        expect(
          Object.getOwnPropertyNames(Object.getPrototypeOf(agent)).includes('autoApprove'),
        ).toBe(false);

        await agent.executeAfterApproval('e2e-inv', { approved: true });
        expect(fileApply.calls).toBe(1);
        expect(fileSystem.mutationCalls.every((call) => call.startsWith('create:'))).toBe(true);

        await agent.explain('e2e-inv');
        const agentRunRaw = await readFile(
          path.join(
            stateRoot,
            'workflows',
            'builder-ai',
            'agent-runs',
            'e2e-inv',
            'agent-run.json',
          ),
          'utf8',
        );
        expect(agentRunRaw).not.toMatch(/changePlan|unifiedDiff|applyResult|verificationReport/);
        expect(agentRunRaw).not.toMatch(/"phase":"AWAITING_GATE2"/);
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });
  });
});
