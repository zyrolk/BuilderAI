import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApprovalBinding, validateApprovalBinding } from '../../../../core/workflow-ledger';
import {
  FilesystemWorkflowLedgerStore,
  NodeRepositoryBaselineService,
  StartupRecoveryInspector,
} from '../../../../infrastructure/workflow-ledger';
import { WorkflowLedgerOrchestrationService } from '../workflow-ledger-orchestration.service';
import { CHANGE_PLAN } from '../../../../ui/workspace/test/workspace.fixture';

describe('WorkflowLedgerOrchestrationService authorization branches', () => {
  let tempRoot: string;
  let stateRoot: string;
  let projectRoot: string;
  let ledger: FilesystemWorkflowLedgerStore;
  let orchestration: WorkflowLedgerOrchestrationService;
  const clock = { now: () => new Date('2026-08-20T12:00:00.000Z') };
  const ids = { generate: () => `id-${Math.random().toString(16).slice(2, 10)}` };

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'orch-auth-'));
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

  function gate2() {
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

  it('rejects apply when no approval binding exists', async () => {
    const workflowId = 'no-binding';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    const result = await orchestration.validateApplyAuthorization({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: gate2(),
      repositoryRoot: projectRoot,
    });
    expect(result).toEqual({
      kind: 'REJECTED',
      code: 'APPROVAL_INVALIDATED',
      message: 'No durable approval binding exists for this preparation.',
    });
  });

  it('rejects apply when diff digest mismatches', async () => {
    const workflowId = 'diff-mismatch';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    const baselineDigest = (await orchestration.readBaselineDigest(workflowId)) ?? '';
    await orchestration.recordApprovalGranted({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: gate2(),
      baselineDigest,
      expiresAt: new Date('2026-08-20T13:00:00.000Z'),
      approvalIdentity: 'operator',
    });
    const wrongGate2 = {
      ...gate2(),
      operationDiffs: [
        {
          ...gate2().operationDiffs[0]!,
          logicalPath: 'src/other.ts',
        },
      ],
    };
    const result = await orchestration.validateApplyAuthorization({
      workflowId,
      preparationId: workflowId,
      changePlan: CHANGE_PLAN,
      gate2Review: wrongGate2,
      repositoryRoot: projectRoot,
    });
    expect(result.kind).toBe('REJECTED');
    if (result.kind === 'REJECTED') {
      expect(result.code).toBe('DIFF_MISMATCH');
    }
  });

  it('records recovery required when apply operation is uncertain', async () => {
    const workflowId = 'uncertain-apply';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    await orchestration.beginApplyJournal({ workflowId, preparationId: workflowId });
    await orchestration.recordApplyOperation({
      workflowId,
      entry: {
        operationId: 'op-1',
        operationType: 'UPDATE_FILE',
        logicalPath: 'src/a.ts',
        operationState: 'UNCERTAIN',
        rollbackState: 'UNCERTAIN',
        timestamp: clock.now().toISOString(),
      },
    });
    const events = await ledger.readEvents(workflowId);
    expect(events.some((e) => e.eventType === 'RECOVERY_REQUIRED')).toBe(true);
  });

  it('emits APPLY_FAILED when journal recovery state is manual', async () => {
    const workflowId = 'apply-failed';
    await orchestration.beginWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Test',
    });
    await orchestration.beginApplyJournal({ workflowId, preparationId: workflowId });
    await ledger.saveApplyJournal(workflowId, {
      schemaVersion: 1,
      workflowId,
      preparationId: workflowId,
      applyStartedAt: clock.now().toISOString(),
      recoveryState: 'MANUAL_RECOVERY_REQUIRED',
      entries: [
        {
          operationId: 'op-1',
          operationType: 'UPDATE_FILE',
          logicalPath: 'src/a.ts',
          operationState: 'UNCERTAIN',
          rollbackState: 'UNCERTAIN',
          timestamp: clock.now().toISOString(),
        },
      ],
    });
    await orchestration.completeApplyJournal({ workflowId, applyResult: 'PARTIALLY_APPLIED' });
    const events = await ledger.readEvents(workflowId);
    expect(events.some((e) => e.eventType === 'APPLY_FAILED')).toBe(true);
  });

  it('digests context and prompt packages', () => {
    expect(orchestration.digestContextPackage({})).toHaveLength(16);
    expect(orchestration.digestPromptPackage({ metadata: { templateId: 't1' } })).toHaveLength(16);
  });
});

describe('approval binding validator branches', () => {
  const clock = new Date('2026-08-20T12:00:00.000Z');
  const binding = createApprovalBinding({
    workflowId: 'wf',
    preparationId: 'prep',
    changePlanDigest: 'plan-a',
    diffDigest: 'diff-a',
    baselineDigest: 'base-a',
    approvedAt: new Date('2026-08-20T10:00:00.000Z'),
    expiresAt: new Date('2026-08-20T13:00:00.000Z'),
    approvalIdentity: 'operator',
  });

  it('rejects diff mismatch', () => {
    const result = validateApprovalBinding({
      binding,
      currentChangePlanDigest: 'plan-a',
      currentDiffDigest: 'diff-b',
      currentBaselineDigest: 'base-a',
      now: clock,
    });
    expect(result).toEqual({
      kind: 'INVALID',
      code: 'DIFF_MISMATCH',
      message: 'Gate 2 diff digest does not match approved preparation.',
    });
  });

  it('rejects baseline mismatch without drift event', () => {
    const result = validateApprovalBinding({
      binding,
      currentChangePlanDigest: 'plan-a',
      currentDiffDigest: 'diff-a',
      currentBaselineDigest: 'base-b',
      now: clock,
    });
    expect(result).toEqual({
      kind: 'INVALID',
      code: 'BASELINE_MISMATCH',
      message: 'Repository baseline digest does not match approved preparation.',
    });
  });

  it('accepts valid binding', () => {
    expect(
      validateApprovalBinding({
        binding,
        currentChangePlanDigest: 'plan-a',
        currentDiffDigest: 'diff-a',
        currentBaselineDigest: 'base-a',
        now: clock,
      }),
    ).toEqual({ kind: 'VALID' });
  });
});

describe('StartupRecoveryInspector branches', () => {
  let tempRoot: string;
  let stateRoot: string;
  let projectRoot: string;
  let ledger: FilesystemWorkflowLedgerStore;
  const clock = new Date('2026-08-20T12:00:00.000Z');
  const ids = { generate: () => `id-${Math.random().toString(16).slice(2, 10)}` };

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'recovery-insp-'));
    stateRoot = path.join(tempRoot, 'state');
    projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    ledger = new FilesystemWorkflowLedgerStore({ stateRoot, workflowsDirectoryName: 'workflows' });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('detects incomplete verification, correction, stale approval, and baseline drift', async () => {
    const workflowId = 'inspect-all';
    await ledger.createWorkflow({
      workflowId,
      projectId: 'project-a',
      repositoryRoot: projectRoot,
      originalRequest: 'Inspect',
      timestamp: clock.toISOString(),
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'VERIFICATION_STARTED',
      payload: {},
      eventId: ids.generate(),
      timestamp: clock.toISOString(),
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'CORRECTION_STARTED',
      payload: { attempt: 1 },
      eventId: ids.generate(),
      timestamp: clock.toISOString(),
    });
    await ledger.appendEvent({
      workflowId,
      eventType: 'BASELINE_DRIFT_DETECTED',
      payload: {},
      eventId: ids.generate(),
      timestamp: clock.toISOString(),
    });
    const manifest = await ledger.readManifest(workflowId);
    expect(manifest).toBeDefined();
    const manifestPath = path.join(
      stateRoot,
      'workflows',
      'project-a',
      workflowId,
      'manifest.json',
    );
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          ...manifest,
          approvalProvenance: {
            preparationId: workflowId,
            changePlanDigest: 'plan',
            diffDigest: 'diff',
            baselineDigest: 'base',
            approvedAt: '2026-08-20T10:00:00.000Z',
            expiresAt: '2026-08-20T11:00:00.000Z',
            approvalIdentity: 'operator',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const inspection = await new StartupRecoveryInspector(ledger).inspectWorkflow(
      JSON.parse(await readFile(manifestPath, 'utf8')),
      new Date('2026-08-20T13:00:00.000Z'),
    );
    expect(inspection.hasIncompleteVerification).toBe(true);
    expect(inspection.hasIncompleteCorrection).toBe(true);
    expect(inspection.hasStaleApproval).toBe(true);
    expect(inspection.hasBaselineDriftEvent).toBe(true);
  });

  it('lists all project workflows on inspectProject', async () => {
    for (const workflowId of ['wf-1', 'wf-2']) {
      await ledger.createWorkflow({
        workflowId,
        projectId: 'project-a',
        repositoryRoot: projectRoot,
        originalRequest: workflowId,
        timestamp: clock.toISOString(),
      });
    }
    const inspections = await new StartupRecoveryInspector(ledger).inspectProject(
      'project-a',
      clock,
    );
    expect(inspections).toHaveLength(2);
  });
});

describe('NodeRepositoryBaselineService filesystem sample', () => {
  it('captures file entries when git is unavailable', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'baseline-fs-'));
    const projectRoot = path.join(tempRoot, 'project');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(path.join(projectRoot, 'readme.txt'), 'hello', 'utf8');
    const baseline = await new NodeRepositoryBaselineService().capture(projectRoot);
    expect(baseline.gitAvailable).toBe(false);
    expect(baseline.fileEntries.length).toBeGreaterThan(0);
    expect(baseline.untrackedFileCount).toBeGreaterThan(0);
    await rm(tempRoot, { recursive: true, force: true });
  });
});
