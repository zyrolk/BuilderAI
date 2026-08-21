import type {
  ApplyRecoveryJournalEntry,
  ApplyRecoveryState,
} from '../types/apply-recovery-journal.types';
import type { WorkflowEvent, WorkflowEventType } from '../types/workflow-event.types';
import type {
  WorkflowClassification,
  WorkflowManifest,
  WorkflowState,
} from '../types/workflow-ledger.types';

export interface DurableApplyRecoverySignal {
  readonly status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CLEARED';
  readonly recoveryClassification: 'NONE' | 'RECOVERY_REQUIRED' | 'MANUAL_RECOVERY_REQUIRED';
}

export function classifyWorkflow(
  manifest: WorkflowManifest,
  events: readonly WorkflowEvent[],
  now: Date,
  durableCheckpoint?: DurableApplyRecoverySignal,
): WorkflowClassification {
  if (manifest.workflowState === 'COMPLETED') return 'COMPLETED';
  if (manifest.workflowState === 'CANCELLED') return 'CANCELLED';
  if (manifest.workflowState === 'FAILED') return 'FAILED';
  if (manifest.workflowState === 'RECOVERY_REQUIRED') return 'RECOVERY_REQUIRED';

  const hasRecoveryRequired = events.some((event) => event.eventType === 'RECOVERY_REQUIRED');
  if (hasRecoveryRequired) return 'RECOVERY_REQUIRED';

  const hasBaselineDrift = events.some((event) => event.eventType === 'BASELINE_DRIFT_DETECTED');
  if (hasBaselineDrift) return 'RECOVERY_REQUIRED';

  if (
    durableCheckpoint !== undefined &&
    (durableCheckpoint.recoveryClassification === 'RECOVERY_REQUIRED' ||
      durableCheckpoint.recoveryClassification === 'MANUAL_RECOVERY_REQUIRED' ||
      durableCheckpoint.status === 'IN_PROGRESS' ||
      durableCheckpoint.status === 'FAILED')
  ) {
    return 'RECOVERY_REQUIRED';
  }

  const applyStarted = events.some((event) => event.eventType === 'APPLY_STARTED');
  const applyTerminal = events.some(
    (event) =>
      event.eventType === 'APPLY_FAILED' ||
      event.eventType === 'ROLLBACK_COMPLETED' ||
      event.eventType === 'VERIFICATION_STARTED' ||
      event.eventType === 'VERIFICATION_COMPLETED' ||
      event.eventType === 'WORKFLOW_COMPLETED' ||
      event.eventType === 'WORKFLOW_FAILED' ||
      event.eventType === 'WORKFLOW_CANCELLED',
  );
  if ((manifest.workflowState === 'APPLYING' || applyStarted) && !applyTerminal) {
    return 'RECOVERY_REQUIRED';
  }

  if (
    manifest.approvalProvenance !== undefined &&
    now.getTime() > Date.parse(manifest.approvalProvenance.expiresAt)
  ) {
    return 'EXPIRED';
  }

  if (
    manifest.workflowState === 'AWAITING_APPROVAL' ||
    events.some((event) => event.eventType === 'GATE2_READY')
  ) {
    const hasApproval = events.some((event) => event.eventType === 'APPROVAL_GRANTED');
    if (!hasApproval) return 'WAITING_FOR_APPROVAL';
  }

  if (
    manifest.workflowState === 'VERIFYING' ||
    manifest.workflowState === 'CORRECTING' ||
    manifest.workflowState === 'PREPARING'
  ) {
    return 'RESUMABLE';
  }

  return 'RESUMABLE';
}

export function deriveWorkflowStateFromEvent(
  current: WorkflowState,
  eventType: WorkflowEventType,
): WorkflowState {
  switch (eventType) {
    case 'WORKFLOW_CREATED':
      return 'CREATED';
    case 'INVESTIGATION_COMPLETED':
      return 'INVESTIGATING';
    case 'PREPARE_COMPLETED':
    case 'GATE2_READY':
      return 'AWAITING_APPROVAL';
    case 'APPLY_STARTED':
      return 'APPLYING';
    case 'VERIFICATION_STARTED':
    case 'VERIFICATION_COMPLETED':
    case 'RUNTIME_VERIFICATION_COMPLETED':
      return 'VERIFYING';
    case 'CORRECTION_STARTED':
    case 'CORRECTION_PREPARED':
    case 'CORRECTION_APPROVED':
    case 'CORRECTION_APPLIED':
      return 'CORRECTING';
    case 'CORRECTION_VERIFIED':
    case 'WORKFLOW_COMPLETED':
      return 'COMPLETED';
    case 'WORKFLOW_FAILED':
    case 'APPLY_FAILED':
      return 'FAILED';
    case 'WORKFLOW_CANCELLED':
      return 'CANCELLED';
    case 'RECOVERY_REQUIRED':
    case 'BASELINE_DRIFT_DETECTED':
    case 'APPROVAL_INVALIDATED':
      return 'RECOVERY_REQUIRED';
    default:
      return current;
  }
}

export function deriveApplyRecoveryState(
  entries: readonly Pick<ApplyRecoveryJournalEntry, 'operationState' | 'rollbackState'>[],
): ApplyRecoveryState {
  if (entries.length === 0) return 'NO_MUTATION';

  const uncertain = entries.filter(
    (entry) => entry.operationState === 'UNCERTAIN' || entry.rollbackState === 'UNCERTAIN',
  );
  const rollbackFailed = entries.filter((entry) => entry.rollbackState === 'FAILED');
  if (uncertain.length > 0 || rollbackFailed.length > 0) return 'MANUAL_RECOVERY_REQUIRED';

  const allCompleted = entries.every((entry) => entry.operationState === 'COMPLETED');
  if (allCompleted) return 'MUTATION_COMPLETED';

  const rolledBack = entries.some(
    (entry) => entry.operationState === 'FAILED' && entry.rollbackState === 'COMPLETED',
  );
  if (
    rolledBack &&
    entries.every(
      (entry) => entry.rollbackState === 'COMPLETED' || entry.operationState === 'COMPLETED',
    )
  ) {
    return 'ROLLBACK_COMPLETED';
  }

  if (
    entries.some(
      (entry) => entry.operationState === 'FAILED' && entry.rollbackState === 'COMPLETED',
    )
  ) {
    return 'ROLLBACK_COMPLETED';
  }

  return 'MUTATION_UNCERTAIN';
}
