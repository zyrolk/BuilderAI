import type { ProjectChangePlan } from '../../../core/change-planner';
import type { Gate2ReviewProjection } from '../gate2-review';
import {
  createApprovalBinding,
  detectRepositoryBaselineDrift,
  digestChangePlanOperations,
  digestGate2Review,
  digestStructured,
  validateApprovalBinding,
  type ApplyRecoveryJournal,
  type ApplyRecoveryJournalEntry,
  type RepositoryBaseline,
  type RepositoryBaselinePort,
  type WorkflowLedgerPort,
  deriveApplyRecoveryState,
} from '../../../core/workflow-ledger';

export interface WorkflowLedgerOrchestrationClock {
  now(): Date;
}

export interface WorkflowLedgerOrchestrationIds {
  generate(): string;
}

export interface WorkflowLedgerOrchestrationConfiguration {
  readonly leaseDurationMs: number;
  readonly ownerIdentity: string;
}

export const DEFAULT_WORKFLOW_LEDGER_ORCHESTRATION_CONFIGURATION: WorkflowLedgerOrchestrationConfiguration =
  {
    leaseDurationMs: 300_000,
    ownerIdentity: 'builderai-local-runtime',
  };

export class WorkflowLedgerOrchestrationService {
  private readonly approvalBindings = new Map<string, ReturnType<typeof createApprovalBinding>>();

  constructor(
    private readonly ledger: WorkflowLedgerPort,
    private readonly baseline: RepositoryBaselinePort,
    private readonly clock: WorkflowLedgerOrchestrationClock,
    private readonly ids: WorkflowLedgerOrchestrationIds,
    private readonly configuration: WorkflowLedgerOrchestrationConfiguration = DEFAULT_WORKFLOW_LEDGER_ORCHESTRATION_CONFIGURATION,
  ) {}

  async beginWorkflow(input: {
    readonly workflowId: string;
    readonly projectId: string;
    readonly repositoryRoot: string;
    readonly originalRequest: string;
    readonly normalizedRequest?: string;
  }): Promise<{ readonly baseline: RepositoryBaseline; readonly baselineDigest: string }> {
    const timestamp = this.clock.now().toISOString();
    await this.ledger.createWorkflow({
      workflowId: input.workflowId,
      projectId: input.projectId,
      repositoryRoot: input.repositoryRoot,
      originalRequest: input.originalRequest,
      normalizedRequest: input.normalizedRequest,
      timestamp,
    });
    const captured = await this.baseline.capture(input.repositoryRoot);
    await this.ledger.saveBaseline(input.workflowId, captured);
    return { baseline: captured, baselineDigest: captured.baselineDigest };
  }

  async recordPrepareCompleted(input: {
    readonly workflowId: string;
    readonly preparationId: string;
    readonly changePlan: ProjectChangePlan;
    readonly gate2Review: Gate2ReviewProjection;
    readonly providerIdentity: string;
    readonly contextPackageDigest: string;
    readonly promptPackageDigest: string;
    readonly providerAttemptSummary: string;
  }): Promise<void> {
    const timestamp = this.clock.now().toISOString();
    const changePlanDigest = digestChangePlanOperations(input.changePlan);
    const diffDigest = digestGate2Review(input.gate2Review);
    const baseline = await this.ledger.readBaseline(input.workflowId);
    await this.ledger.appendEvent({
      workflowId: input.workflowId,
      eventType: 'PREPARE_COMPLETED',
      payload: {
        preparationId: input.preparationId,
        changePlanDigest,
        contextPackageDigest: input.contextPackageDigest,
        promptPackageDigest: input.promptPackageDigest,
        providerIdentity: input.providerIdentity,
        providerAttemptSummary: input.providerAttemptSummary,
      },
      eventId: this.ids.generate(),
      timestamp,
    });
    await this.ledger.appendEvent({
      workflowId: input.workflowId,
      eventType: 'GATE2_READY',
      payload: {
        preparationId: input.preparationId,
        changePlanDigest,
        diffDigest,
        baselineDigest: baseline?.baselineDigest ?? null,
      },
      eventId: this.ids.generate(),
      timestamp,
    });
  }

  async recordApprovalGranted(input: {
    readonly workflowId: string;
    readonly preparationId: string;
    readonly changePlan: ProjectChangePlan;
    readonly gate2Review: Gate2ReviewProjection;
    readonly baselineDigest: string;
    readonly expiresAt: Date;
    readonly approvalIdentity: string;
  }): Promise<void> {
    const binding = createApprovalBinding({
      workflowId: input.workflowId,
      preparationId: input.preparationId,
      changePlanDigest: digestChangePlanOperations(input.changePlan),
      diffDigest: digestGate2Review(input.gate2Review),
      baselineDigest: input.baselineDigest,
      approvedAt: this.clock.now(),
      expiresAt: input.expiresAt,
      approvalIdentity: input.approvalIdentity,
    });
    this.approvalBindings.set(input.preparationId, binding);
    await this.ledger.appendEvent({
      workflowId: input.workflowId,
      eventType: 'APPROVAL_GRANTED',
      payload: {
        preparationId: input.preparationId,
        changePlanDigest: binding.changePlanDigest,
        diffDigest: binding.diffDigest,
        baselineDigest: binding.baselineDigest,
        approvedAt: binding.approvedAt,
        expiresAt: binding.expiresAt,
      },
      eventId: this.ids.generate(),
      timestamp: binding.approvedAt,
    });
  }

  async validateApplyAuthorization(input: {
    readonly workflowId: string;
    readonly preparationId: string;
    readonly changePlan: ProjectChangePlan;
    readonly gate2Review: Gate2ReviewProjection;
    readonly repositoryRoot: string;
  }): Promise<
    | { readonly kind: 'AUTHORIZED'; readonly baselineDigest: string }
    | { readonly kind: 'REJECTED'; readonly code: string; readonly message: string }
  > {
    const binding = this.approvalBindings.get(input.preparationId);
    if (binding === undefined) {
      return {
        kind: 'REJECTED',
        code: 'APPROVAL_INVALIDATED',
        message: 'No durable approval binding exists for this preparation.',
      };
    }

    const currentBaseline = await this.baseline.capture(input.repositoryRoot);
    const drift = detectRepositoryBaselineDrift({
      boundBaselineDigest: binding.baselineDigest,
      currentBaseline,
    });
    if (drift.kind === 'DRIFT') {
      await this.ledger.appendEvent({
        workflowId: input.workflowId,
        eventType: 'BASELINE_DRIFT_DETECTED',
        payload: {
          preparationId: input.preparationId,
          previousDigest: drift.previousDigest,
          currentDigest: drift.currentDigest,
        },
        eventId: this.ids.generate(),
        timestamp: this.clock.now().toISOString(),
      });
      return {
        kind: 'REJECTED',
        code: 'BASELINE_DRIFT_DETECTED',
        message: 'Repository baseline changed since approval; fresh prepare is required.',
      };
    }

    const validation = validateApprovalBinding({
      binding,
      currentChangePlanDigest: digestChangePlanOperations(input.changePlan),
      currentDiffDigest: digestGate2Review(input.gate2Review),
      currentBaselineDigest: currentBaseline.baselineDigest,
      now: this.clock.now(),
    });
    if (validation.kind === 'INVALID') {
      await this.ledger.appendEvent({
        workflowId: input.workflowId,
        eventType: 'APPROVAL_INVALIDATED',
        payload: {
          preparationId: input.preparationId,
          code: validation.code,
        },
        eventId: this.ids.generate(),
        timestamp: this.clock.now().toISOString(),
      });
      return {
        kind: 'REJECTED',
        code: validation.code,
        message: validation.message,
      };
    }

    return { kind: 'AUTHORIZED', baselineDigest: currentBaseline.baselineDigest };
  }

  async acquireApplyLease(workflowId: string): Promise<void> {
    const now = this.clock.now();
    await this.ledger.acquireLease({
      workflowId,
      ownerIdentity: this.configuration.ownerIdentity,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.configuration.leaseDurationMs).toISOString(),
    });
  }

  async releaseApplyLease(workflowId: string): Promise<void> {
    await this.ledger.releaseLease(workflowId, this.configuration.ownerIdentity);
  }

  async beginApplyJournal(input: {
    readonly workflowId: string;
    readonly preparationId: string;
  }): Promise<void> {
    const timestamp = this.clock.now().toISOString();
    await this.ledger.appendEvent({
      workflowId: input.workflowId,
      eventType: 'APPLY_STARTED',
      payload: { preparationId: input.preparationId },
      eventId: this.ids.generate(),
      timestamp,
    });
    const journal: ApplyRecoveryJournal = {
      schemaVersion: 1,
      workflowId: input.workflowId,
      preparationId: input.preparationId,
      applyStartedAt: timestamp,
      recoveryState: 'NO_MUTATION',
      entries: [],
    };
    await this.ledger.saveApplyJournal(input.workflowId, journal);
  }

  async recordApplyOperation(input: {
    readonly workflowId: string;
    readonly entry: ApplyRecoveryJournalEntry;
  }): Promise<void> {
    const journal = await this.ledger.readApplyJournal(input.workflowId);
    if (journal === undefined) return;
    const entries = [...journal.entries, input.entry];
    const recoveryState = deriveApplyRecoveryState(entries);
    await this.ledger.saveApplyJournal(input.workflowId, {
      ...journal,
      entries,
      recoveryState,
    });
    await this.ledger.appendEvent({
      workflowId: input.workflowId,
      eventType: 'APPLY_OPERATION_COMPLETED',
      payload: {
        operationId: input.entry.operationId,
        logicalPath: input.entry.logicalPath,
        operationState: input.entry.operationState,
      },
      eventId: this.ids.generate(),
      timestamp: input.entry.timestamp,
    });
    if (recoveryState === 'MANUAL_RECOVERY_REQUIRED') {
      await this.recordRecoveryRequired(input.workflowId, 'INDETERMINATE_MUTATION');
    }
  }

  async completeApplyJournal(input: {
    readonly workflowId: string;
    readonly applyResult: string;
  }): Promise<void> {
    const journal = await this.ledger.readApplyJournal(input.workflowId);
    if (journal === undefined) return;
    const completedAt = this.clock.now().toISOString();
    await this.ledger.saveApplyJournal(input.workflowId, {
      ...journal,
      applyCompletedAt: completedAt,
      recoveryState: deriveApplyRecoveryState(journal.entries),
    });
    await this.ledger.appendEvent({
      workflowId: input.workflowId,
      eventType:
        journal.recoveryState === 'MANUAL_RECOVERY_REQUIRED'
          ? 'APPLY_FAILED'
          : 'WORKFLOW_COMPLETED',
      payload: { applyResult: input.applyResult },
      eventId: this.ids.generate(),
      timestamp: completedAt,
    });
  }

  async recordRecoveryRequired(workflowId: string, reason: string): Promise<void> {
    await this.ledger.appendEvent({
      workflowId,
      eventType: 'RECOVERY_REQUIRED',
      payload: { reason },
      eventId: this.ids.generate(),
      timestamp: this.clock.now().toISOString(),
    });
  }

  digestContextPackage(contextPackage: { readonly metadata?: Record<string, unknown> }): string {
    return digestStructured(contextPackage.metadata ?? {}).slice(0, 16);
  }

  digestPromptPackage(promptPackage: { readonly metadata?: Record<string, unknown> }): string {
    return digestStructured(promptPackage.metadata ?? {}).slice(0, 16);
  }

  async readBaselineDigest(workflowId: string): Promise<string | undefined> {
    const baseline = await this.ledger.readBaseline(workflowId);
    return baseline?.baselineDigest;
  }
}
