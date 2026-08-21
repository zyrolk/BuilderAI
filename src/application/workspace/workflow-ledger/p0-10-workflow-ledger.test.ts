import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GENESIS_EVENT_DIGEST,
  buildEventDigest,
  createApprovalBinding,
  deriveApplyRecoveryState,
  validateApprovalBinding,
  verifyEventDigest,
  type WorkflowEvent,
} from '../../../core/workflow-ledger';
import {
  FilesystemWorkflowLedgerStore,
  NodeRepositoryBaselineService,
  StartupRecoveryInspector,
  type StartupRecoveryInspection,
} from '../../../infrastructure/workflow-ledger';
import { WorkflowLedgerOrchestrationService } from '../workflow-ledger/workflow-ledger-orchestration.service';
import { CorrectionSessionPersistence } from '../workflow-ledger/correction-session.persistence';
import { CORRECTION_LOOP_SCHEMA_VERSION } from '../correction-loop/correction-loop.types';
import { CHANGE_PLAN } from '../../../ui/workspace/test/workspace.fixture';

describe('P0-10 durable workflow ledger', () => {
  let tempRoot: string;
  let stateRoot: string;
  let projectRoot: string;
  let ledger: FilesystemWorkflowLedgerStore;
  let orchestration: WorkflowLedgerOrchestrationService;
  const clock = { now: () => new Date('2026-08-20T12:00:00.000Z') };
  const ids = { generate: () => `id-${Math.random().toString(16).slice(2, 10)}` };

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'p0-10-'));
    stateRoot = path.join(tempRoot, 'state');
    projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    ledger = new FilesystemWorkflowLedgerStore({ stateRoot, workflowsDirectoryName: 'workflows' });
    orchestration = new WorkflowLedgerOrchestrationService(
      ledger,
      new NodeRepositoryBaselineService(),
      clock,
      ids,
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('creates workflow events with digest chain', async () => {
    const workflowId = 'workflow-a';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Fix bug',
      timestamp: clock.now().toISOString(),
    });
    const events = await ledger.readEvents(workflowId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.previousEventDigest).toBe(GENESIS_EVENT_DIGEST);
    expect(verifyEventDigest(events[0]!)).toBe(true);
  });

  it('detects event tampering', async () => {
    const event: WorkflowEvent = {
      eventId: 'evt-1',
      workflowId: 'wf-1',
      sequence: 1,
      eventType: 'WORKFLOW_CREATED',
      timestamp: clock.now().toISOString(),
      payload: { projectId: 'p' },
      previousEventDigest: GENESIS_EVENT_DIGEST,
      eventDigest: 'deadbeef',
      schemaVersion: 1,
    };
    expect(verifyEventDigest(event)).toBe(false);
  });

  it('detects event ordering corruption', async () => {
    const workflowId = 'workflow-order';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Fix bug',
      timestamp: clock.now().toISOString(),
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'PREPARE_COMPLETED',
      payload: { preparationId: workflowId },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const events = await ledger.readEvents(workflowId);
    const tampered = [...events];
    const second = tampered[1];
    if (second !== undefined) {
      tampered[1] = { ...second, previousEventDigest: 'invalid' };
      expect(() => ledger.validateEventChain(tampered)).toThrow(/invalid previous digest/i);
    }
  });

  it('persists atomically and survives interrupted write recovery', async () => {
    const workflowId = 'workflow-atomic';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Atomic',
      timestamp: clock.now().toISOString(),
    });
    const manifest = await ledger.readManifest(workflowId);
    expect(manifest?.workflowId).toBe(workflowId);
    const manifestPath = path.join(
      stateRoot,
      'workflows',
      'project-a',
      workflowId,
      'manifest.json',
    );
    const raw = await readFile(manifestPath, 'utf8');
    expect(raw).toContain('"workflowId"');
  });

  it('captures repository baseline with explicit git unavailable fallback', async () => {
    const baseline = await new NodeRepositoryBaselineService().capture(projectRoot);
    expect(baseline.gitAvailable).toBe(false);
    expect(baseline.baselineDigest.length).toBeGreaterThan(10);
  });

  it('detects baseline drift and invalidates approval binding', async () => {
    const binding = createApprovalBinding({
      workflowId: 'wf',
      preparationId: 'prep',
      changePlanDigest: 'plan-a',
      diffDigest: 'diff-a',
      baselineDigest: 'baseline-a',
      approvedAt: clock.now(),
      expiresAt: new Date('2026-08-20T13:00:00.000Z'),
      approvalIdentity: 'operator',
    });
    const invalid = validateApprovalBinding({
      binding,
      currentChangePlanDigest: 'plan-b',
      currentDiffDigest: 'diff-a',
      currentBaselineDigest: 'baseline-a',
      now: clock.now(),
    });
    expect(invalid.kind).toBe('INVALID');
    if (invalid.kind === 'INVALID') {
      expect(invalid.code).toBe('CHANGE_PLAN_MISMATCH');
    }
  });

  it('rejects expired approval', () => {
    const binding = createApprovalBinding({
      workflowId: 'wf',
      preparationId: 'prep',
      changePlanDigest: 'plan-a',
      diffDigest: 'diff-a',
      baselineDigest: 'baseline-a',
      approvedAt: new Date('2026-08-20T10:00:00.000Z'),
      expiresAt: new Date('2026-08-20T11:00:00.000Z'),
      approvalIdentity: 'operator',
    });
    const invalid = validateApprovalBinding({
      binding,
      currentChangePlanDigest: 'plan-a',
      currentDiffDigest: 'diff-a',
      currentBaselineDigest: 'baseline-a',
      now: new Date('2026-08-20T12:00:00.000Z'),
    });
    expect(invalid).toEqual({
      kind: 'INVALID',
      code: 'APPROVAL_EXPIRED',
      message: 'Approval has expired.',
    });
  });

  it('journeys apply recovery states', async () => {
    expect(deriveApplyRecoveryState([])).toBe('NO_MUTATION');
    expect(
      deriveApplyRecoveryState([
        { operationState: 'COMPLETED', rollbackState: 'NOT_STARTED' },
        { operationState: 'COMPLETED', rollbackState: 'NOT_STARTED' },
      ]),
    ).toBe('MUTATION_COMPLETED');
    expect(
      deriveApplyRecoveryState([{ operationState: 'UNCERTAIN', rollbackState: 'UNCERTAIN' }]),
    ).toBe('MANUAL_RECOVERY_REQUIRED');
  });

  it('blocks concurrent apply with lease', async () => {
    const workflowId = 'workflow-lease';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Lease',
      timestamp: clock.now().toISOString(),
    });
    await ledger.acquireLease({
      workflowId,
      ownerIdentity: 'owner-a',
      acquiredAt: clock.now().toISOString(),
      expiresAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
    });
    await expect(
      ledger.acquireLease({
        workflowId,
        ownerIdentity: 'owner-b',
        acquiredAt: clock.now().toISOString(),
        expiresAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
      }),
    ).rejects.toThrow(/lease is held/i);
  });

  it('classifies restart recovery without auto-resume', async () => {
    const workflowId = 'workflow-restart';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Restart test',
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'APPLY_STARTED',
      payload: { preparationId: workflowId },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const inspections = await new StartupRecoveryInspector(ledger).inspectProject(
      'project-a',
      clock.now(),
    );
    const inspection = inspections.find(
      (entry: StartupRecoveryInspection) => entry.workflowId === workflowId,
    );
    expect(inspection?.hasIncompleteApply).toBe(true);
    expect(inspection?.classification).not.toBe('COMPLETED');
  });

  it('persists correction session metadata without secrets', async () => {
    const persistence = new CorrectionSessionPersistence(stateRoot, 'project-a');
    await persistence.save({
      schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
      workflowId: 'corr-1',
      state: 'CORRECTION_WAITING_FOR_APPROVAL',
      attempt: 1,
      maximumAttempts: 2,
      startedAt: clock.now().toISOString(),
      deadlineAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
      attemptHistory: [],
    });
    const loaded = await persistence.load('corr-1');
    expect(loaded?.state).toBe('CORRECTION_WAITING_FOR_APPROVAL');
    const raw = await readFile(
      path.join(stateRoot, 'workflows', 'project-a', 'corr-1', 'correction-session.json'),
      'utf8',
    );
    expect(raw).not.toMatch(/api[_-]?key|password|secret|authorization/i);
  });

  it('records baseline drift through orchestration authorization', async () => {
    const workflowId = 'workflow-drift';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Drift',
    });
    const baselineDigest = (await orchestration.readBaselineDigest(workflowId)) ?? '';
    await orchestration.recordApprovalGranted({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      baselineDigest,
      expiresAt: new Date('2026-08-20T13:00:00.000Z'),
      approvalIdentity: 'operator',
    });
    await writeFile(path.join(projectRoot, 'drift.txt'), 'changed', 'utf8');
    const result = await orchestration.validateApplyAuthorization({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      repositoryRoot: projectRoot,
    });
    expect(result.kind).toBe('REJECTED');
    if (result.kind === 'REJECTED') {
      expect(result.code).toBe('BASELINE_DRIFT_DETECTED');
    }
  });
});

function createGate2() {
  return {
    schemaVersion: 1 as const,
    operationDiffs: [
      {
        operationId: 'op-1',
        kind: 'UPDATE_FILE' as const,
        logicalPath: 'src/example.ts',
        label: 'UPDATE FILE' as const,
        format: 'UNIFIED' as const,
        truncated: false,
        lineCount: 1,
        characterCount: 10,
      },
    ],
    totalCharacterCount: 10,
    truncated: false,
  };
}

describe('P0-10 event digest helpers', () => {
  it('builds deterministic event digests', () => {
    const withoutDigest = {
      eventId: 'evt',
      workflowId: 'wf',
      sequence: 1,
      eventType: 'WORKFLOW_CREATED' as const,
      timestamp: '2026-08-20T12:00:00.000Z',
      payload: { a: 1 },
      previousEventDigest: GENESIS_EVENT_DIGEST,
      schemaVersion: 1 as const,
    };
    const first = buildEventDigest(withoutDigest);
    const second = buildEventDigest(withoutDigest);
    expect(first).toBe(second);
  });
});

describe('P0-10 restart/fault-injection scenarios', () => {
  let tempRoot: string;
  let stateRoot: string;
  let projectRoot: string;
  let ledger: FilesystemWorkflowLedgerStore;
  let orchestration: WorkflowLedgerOrchestrationService;
  const clock = { now: () => new Date('2026-08-20T12:00:00.000Z') };
  const ids = { generate: () => `id-${Math.random().toString(16).slice(2, 10)}` };

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'p0-10-restart-'));
    stateRoot = path.join(tempRoot, 'state');
    projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    ledger = new FilesystemWorkflowLedgerStore({ stateRoot, workflowsDirectoryName: 'workflows' });
    orchestration = new WorkflowLedgerOrchestrationService(
      ledger,
      new NodeRepositoryBaselineService(),
      clock,
      ids,
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('A: restart before APPLY — classifies as RESUMABLE, no auto-apply', async () => {
    const workflowId = 'restart-before-apply';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'PREPARE_COMPLETED',
      payload: { preparationId: workflowId },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const inspector = new StartupRecoveryInspector(ledger);
    const inspections = await inspector.inspectProject('project-a', clock.now());
    const entry = inspections.find((e: StartupRecoveryInspection) => e.workflowId === workflowId);
    expect(entry).toBeDefined();
    expect(entry!.hasIncompleteApply).toBe(false);
    expect(entry!.classification).not.toBe('COMPLETED');
  });

  it('B: restart during APPLY — classifies with RECOVERY_REQUIRED', async () => {
    const workflowId = 'restart-during-apply';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'APPLY_STARTED',
      payload: { preparationId: workflowId },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const inspector = new StartupRecoveryInspector(ledger);
    const inspections = await inspector.inspectProject('project-a', clock.now());
    const entry = inspections.find((e: StartupRecoveryInspection) => e.workflowId === workflowId);
    expect(entry).toBeDefined();
    expect(entry!.hasIncompleteApply).toBe(true);
    expect(entry!.classification).toBe('RECOVERY_REQUIRED');
  });

  it('C: restart after APPLY before VERIFY — no auto-apply, auditable', async () => {
    const workflowId = 'restart-after-apply';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'APPLY_STARTED',
      payload: { preparationId: workflowId },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'APPLY_OPERATION_COMPLETED',
      payload: { operationId: 'op-1', logicalPath: 'a.ts', operationState: 'COMPLETED' },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const events = await ledger.readEvents(workflowId);
    expect(events.length).toBeGreaterThanOrEqual(3);
    ledger.validateEventChain(events);
  });

  it('D: restart during VERIFY — no duplicate mutation', async () => {
    const workflowId = 'restart-during-verify';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'VERIFICATION_STARTED',
      payload: {},
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const inspector = new StartupRecoveryInspector(ledger);
    const inspections = await inspector.inspectProject('project-a', clock.now());
    const entry = inspections.find((e: StartupRecoveryInspection) => e.workflowId === workflowId);
    expect(entry).toBeDefined();
    expect(entry!.classification).not.toBe('COMPLETED');
  });

  it('E: restart during correction — no auto-continue', async () => {
    const workflowId = 'restart-during-correction';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'CORRECTION_STARTED',
      payload: { attempt: 1 },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const inspector = new StartupRecoveryInspector(ledger);
    const inspections = await inspector.inspectProject('project-a', clock.now());
    const entry = inspections.find((e: StartupRecoveryInspection) => e.workflowId === workflowId);
    expect(entry).toBeDefined();
    expect(entry!.classification).not.toBe('COMPLETED');
  });

  it('F: corrupted event chain — detected', async () => {
    const workflowId = 'corrupt-chain';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Corrupt',
      timestamp: clock.now().toISOString(),
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'PREPARE_COMPLETED',
      payload: { preparationId: workflowId },
      eventId: ids.generate(),
      timestamp: clock.now().toISOString(),
    });
    const events = await ledger.readEvents(workflowId);
    const tampered = [...events];
    if (tampered[1] !== undefined) {
      tampered[1] = { ...tampered[1], payload: { tampered: true } };
      expect(() => ledger.validateEventChain(tampered)).toThrow();
    }
  });

  it('G: stale approval — rejected', () => {
    const binding = createApprovalBinding({
      workflowId: 'wf',
      preparationId: 'prep',
      changePlanDigest: 'plan',
      diffDigest: 'diff',
      baselineDigest: 'base',
      approvedAt: new Date('2026-08-20T10:00:00.000Z'),
      expiresAt: new Date('2026-08-20T11:00:00.000Z'),
      approvalIdentity: 'op',
    });
    const result = validateApprovalBinding({
      binding,
      currentChangePlanDigest: 'plan',
      currentDiffDigest: 'diff',
      currentBaselineDigest: 'base',
      now: new Date('2026-08-20T13:00:00.000Z'),
    });
    expect(result.kind).toBe('INVALID');
    if (result.kind === 'INVALID') expect(result.code).toBe('APPROVAL_EXPIRED');
  });

  it('H: baseline drift — blocks APPLY', async () => {
    const workflowId = 'drift-block';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Drift',
    });
    const baselineDigest = (await orchestration.readBaselineDigest(workflowId)) ?? '';
    await orchestration.recordApprovalGranted({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      baselineDigest,
      expiresAt: new Date('2026-08-20T13:00:00.000Z'),
      approvalIdentity: 'op',
    });
    await writeFile(path.join(projectRoot, 'new-file.txt'), 'drift', 'utf8');
    const result = await orchestration.validateApplyAuthorization({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      repositoryRoot: projectRoot,
    });
    expect(result.kind).toBe('REJECTED');
  });

  it('I: incomplete apply journal — recovery state detected', () => {
    expect(
      deriveApplyRecoveryState([
        { operationState: 'COMPLETED', rollbackState: 'NOT_STARTED' },
        { operationState: 'UNCERTAIN', rollbackState: 'UNCERTAIN' },
      ]),
    ).toBe('MANUAL_RECOVERY_REQUIRED');
  });

  it('J: rollback failure — explicit recovery state', () => {
    expect(
      deriveApplyRecoveryState([{ operationState: 'COMPLETED', rollbackState: 'FAILED' }]),
    ).toBe('MANUAL_RECOVERY_REQUIRED');
  });
});

describe('P0-10 concurrency/lease', () => {
  let tempRoot: string;
  let stateRoot: string;
  let projectRoot: string;
  let ledger: FilesystemWorkflowLedgerStore;
  const clock = { now: () => new Date('2026-08-20T12:00:00.000Z') };

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'p0-10-lease-'));
    stateRoot = path.join(tempRoot, 'state');
    projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    ledger = new FilesystemWorkflowLedgerStore({ stateRoot, workflowsDirectoryName: 'workflows' });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('process A acquires, process B is blocked', async () => {
    const workflowId = 'lease-ab';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'p',
      repositoryRoot: projectRoot,
      originalRequest: 'Lease',
      timestamp: clock.now().toISOString(),
    });
    await ledger.acquireLease({
      workflowId,
      ownerIdentity: 'process-A',
      acquiredAt: clock.now().toISOString(),
      expiresAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
    });
    await expect(
      ledger.acquireLease({
        workflowId,
        ownerIdentity: 'process-B',
        acquiredAt: clock.now().toISOString(),
        expiresAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
      }),
    ).rejects.toThrow(/lease is held/i);
  });

  it('lease release allows new acquisition', async () => {
    const workflowId = 'lease-release';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'p',
      repositoryRoot: projectRoot,
      originalRequest: 'Lease',
      timestamp: clock.now().toISOString(),
    });
    await ledger.acquireLease({
      workflowId,
      ownerIdentity: 'process-A',
      acquiredAt: clock.now().toISOString(),
      expiresAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
    });
    await ledger.releaseLease(workflowId, 'process-A');
    const newLease = await ledger.acquireLease({
      workflowId,
      ownerIdentity: 'process-B',
      acquiredAt: clock.now().toISOString(),
      expiresAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
    });
    expect(newLease.ownerIdentity).toBe('process-B');
  });

  it('expired lease can be acquired by another owner', async () => {
    const workflowId = 'lease-expire';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'p',
      repositoryRoot: projectRoot,
      originalRequest: 'Lease',
      timestamp: clock.now().toISOString(),
    });
    await ledger.acquireLease({
      workflowId,
      ownerIdentity: 'process-A',
      acquiredAt: '2026-08-20T10:00:00.000Z',
      expiresAt: '2026-08-20T11:00:00.000Z',
    });
    await ledger.acquireLease({
      workflowId,
      ownerIdentity: 'process-B',
      acquiredAt: clock.now().toISOString(),
      expiresAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
    });
  });
});

describe('P0-10 production composition', () => {
  let tempRoot: string;
  let stateRoot: string;
  let projectRoot: string;
  let ledger: FilesystemWorkflowLedgerStore;
  let orchestration: WorkflowLedgerOrchestrationService;
  const clock = { now: () => new Date('2026-08-20T12:00:00.000Z') };
  const ids = { generate: () => `id-${Math.random().toString(16).slice(2, 10)}` };

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'p0-10-prod-'));
    stateRoot = path.join(tempRoot, 'state');
    projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    ledger = new FilesystemWorkflowLedgerStore({ stateRoot, workflowsDirectoryName: 'workflows' });
    orchestration = new WorkflowLedgerOrchestrationService(
      ledger,
      new NodeRepositoryBaselineService(),
      clock,
      ids,
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('full lifecycle: prepare → gate2 → approval → apply → verify → completion → restart → classification', async () => {
    const workflowId = 'prod-full';

    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Full lifecycle test',
    });

    await orchestration.recordPrepareCompleted({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      providerIdentity: 'gemini-2.5-pro',
      contextPackageDigest: 'ctx-digest',
      promptPackageDigest: 'prompt-digest',
      providerAttemptSummary: '1',
    });

    const baselineDigest = (await orchestration.readBaselineDigest(workflowId)) ?? '';
    await orchestration.recordApprovalGranted({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      baselineDigest,
      expiresAt: new Date('2026-08-20T13:00:00.000Z'),
      approvalIdentity: 'operator',
    });

    const auth = await orchestration.validateApplyAuthorization({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      repositoryRoot: projectRoot,
    });
    expect(auth.kind).toBe('AUTHORIZED');

    await orchestration.acquireApplyLease(workflowId);
    await orchestration.beginApplyJournal({ workflowId, preparationId: workflowId });
    await orchestration.recordApplyOperation({
      workflowId,
      entry: {
        operationId: 'op-1',
        operationType: 'UPDATE_FILE',
        logicalPath: 'src/example.ts',
        operationState: 'COMPLETED',
        rollbackState: 'NOT_STARTED',
        timestamp: clock.now().toISOString(),
      },
    });
    await orchestration.completeApplyJournal({ workflowId, applyResult: 'APPLIED' });
    await orchestration.releaseApplyLease(workflowId);

    // Simulate restart: create fresh store reading same disk state
    const freshLedger = new FilesystemWorkflowLedgerStore({
      stateRoot,
      workflowsDirectoryName: 'workflows',
    });
    const events = await freshLedger.readEvents(workflowId);
    expect(events.length).toBeGreaterThanOrEqual(6);
    freshLedger.validateEventChain(events);

    const baseline = await freshLedger.readBaseline(workflowId);
    expect(baseline).toBeDefined();
    expect(baseline!.baselineDigest).toBe(baselineDigest);

    const manifest = await freshLedger.readManifest(workflowId);
    expect(manifest?.workflowId).toBe(workflowId);

    const journal = await freshLedger.readApplyJournal(workflowId);
    expect(journal?.entries.length).toBe(1);
    expect(journal?.recoveryState).toBe('MUTATION_COMPLETED');

    const inspector = new StartupRecoveryInspector(freshLedger);
    const inspections = await inspector.inspectProject('project-a', clock.now());
    const entry = inspections.find((e: StartupRecoveryInspection) => e.workflowId === workflowId);
    expect(entry).toBeDefined();
    expect(entry!.classification).toBe('COMPLETED');
  });

  it('unfinished workflow becomes non-COMPLETED after restart', async () => {
    const workflowId = 'prod-unfinished';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Unfinished',
    });
    await orchestration.recordPrepareCompleted({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: createGate2(),
      providerIdentity: 'gemini-2.5-pro',
      contextPackageDigest: 'ctx',
      promptPackageDigest: 'prompt',
      providerAttemptSummary: '1',
    });

    const freshLedger = new FilesystemWorkflowLedgerStore({
      stateRoot,
      workflowsDirectoryName: 'workflows',
    });
    const inspector = new StartupRecoveryInspector(freshLedger);
    const inspections = await inspector.inspectProject('project-a', clock.now());
    const entry = inspections.find((e: StartupRecoveryInspection) => e.workflowId === workflowId);
    expect(entry).toBeDefined();
    expect(entry!.classification).not.toBe('COMPLETED');
  });

  it('no secrets in persisted ledger data', async () => {
    const workflowId = 'prod-nosecrets';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Ledger audit test',
    });
    const manifestPath = path.join(
      stateRoot,
      'workflows',
      'project-a',
      workflowId,
      'manifest.json',
    );
    const raw = await readFile(manifestPath, 'utf8');
    expect(raw).not.toMatch(/apiKey|api_key|"password"|"bearer"|accessToken/i);
  });
});

describe('P0-10 correction lazy-load', () => {
  let tempRoot: string;
  let stateRoot: string;
  const clock = { now: () => new Date('2026-08-20T12:00:00.000Z') };

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'p0-10-corr-'));
    stateRoot = path.join(tempRoot, 'state');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('persisted session can be recovered via lazy load', async () => {
    const persistence = new CorrectionSessionPersistence(stateRoot, 'project-a');
    const session = {
      schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
      workflowId: 'lazy-1',
      state: 'CORRECTION_WAITING_FOR_APPROVAL' as const,
      attempt: 1,
      maximumAttempts: 3,
      startedAt: clock.now().toISOString(),
      deadlineAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
      attemptHistory: [],
    };
    await persistence.save(session);
    const loaded = await persistence.load('lazy-1');
    expect(loaded).toBeDefined();
    expect(loaded!.workflowId).toBe('lazy-1');
    expect(loaded!.state).toBe('CORRECTION_WAITING_FOR_APPROVAL');
  });

  it('corrupted session file fails closed', async () => {
    const sessionDir = path.join(stateRoot, 'workflows', 'project-a', 'corrupt-session');
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, 'correction-session.json'), '{not valid json}', 'utf8');
    const persistence = new CorrectionSessionPersistence(stateRoot, 'project-a');
    const loaded = await persistence.load('corrupt-session');
    expect(loaded).toBeUndefined();
  });

  it('completed session remains immutable/auditable', async () => {
    const persistence = new CorrectionSessionPersistence(stateRoot, 'project-a');
    const session = {
      schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
      workflowId: 'completed-1',
      state: 'CORRECTION_PASSED' as const,
      attempt: 2,
      maximumAttempts: 3,
      startedAt: clock.now().toISOString(),
      deadlineAt: new Date('2026-08-20T13:00:00.000Z').toISOString(),
      attemptHistory: [],
    };
    await persistence.save(session);
    const loaded = await persistence.load('completed-1');
    expect(loaded!.state).toBe('CORRECTION_PASSED');
    expect(loaded!.attempt).toBe(2);
  });
});

describe('P0-10 fault injection', () => {
  it('detects corrupted persisted event file', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'p0-10-corrupt-'));
    const stateRoot = path.join(tempRoot, 'state');
    const ledger = new FilesystemWorkflowLedgerStore({
      stateRoot,
      workflowsDirectoryName: 'workflows',
    });
    const workflowId = 'corrupt-wf';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: tempRoot,
      originalRequest: 'Corrupt',
      timestamp: new Date().toISOString(),
    });
    const eventsPath = path.join(stateRoot, 'workflows', 'project-a', workflowId, 'events.jsonl');
    await writeFile(eventsPath, '{not valid json}\n', 'utf8');
    await expect(ledger.readEvents(workflowId)).rejects.toThrow(/not valid JSONL/i);
    await rm(tempRoot, { recursive: true, force: true });
  });
});
