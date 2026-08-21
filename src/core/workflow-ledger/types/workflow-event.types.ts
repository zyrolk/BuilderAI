export const WORKFLOW_LEDGER_SCHEMA_VERSION = 1 as const;

export const WORKFLOW_EVENT_TYPES = [
  'WORKFLOW_CREATED',
  'BASELINE_CAPTURED',
  'INVESTIGATION_COMPLETED',
  'PREPARE_COMPLETED',
  'GATE2_READY',
  'APPROVAL_GRANTED',
  'APPROVAL_REJECTED',
  'APPLY_STARTED',
  'APPLY_OPERATION_COMPLETED',
  'APPLY_FAILED',
  'ROLLBACK_STARTED',
  'ROLLBACK_COMPLETED',
  'RECOVERY_REQUIRED',
  'VERIFICATION_STARTED',
  'VERIFICATION_COMPLETED',
  'RUNTIME_VERIFICATION_COMPLETED',
  'CORRECTION_STARTED',
  'CORRECTION_PREPARED',
  'CORRECTION_APPROVED',
  'CORRECTION_APPLIED',
  'CORRECTION_VERIFIED',
  'BASELINE_DRIFT_DETECTED',
  'APPROVAL_INVALIDATED',
  'WORKFLOW_COMPLETED',
  'WORKFLOW_FAILED',
  'WORKFLOW_CANCELLED',
] as const;

export type WorkflowEventType = (typeof WORKFLOW_EVENT_TYPES)[number];

export interface WorkflowEvent {
  readonly eventId: string;
  readonly workflowId: string;
  readonly sequence: number;
  readonly eventType: WorkflowEventType;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
  readonly previousEventDigest: string;
  readonly eventDigest: string;
  readonly schemaVersion: typeof WORKFLOW_LEDGER_SCHEMA_VERSION;
}

export interface WorkflowEventInput {
  readonly workflowId: string;
  readonly eventType: WorkflowEventType;
  readonly payload: Record<string, unknown>;
}
