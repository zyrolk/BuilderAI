export const DURABLE_APPLY_CHECKPOINT_SCHEMA_VERSION = 1 as const;

export type DurableApplyMutationState = 'CAPTURED' | 'MUTATED' | 'UNCERTAIN' | 'ROLLED_BACK';

export type DurableApplyCheckpointStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CLEARED';

export interface DurableApplyCheckpointOperation {
  readonly index: number;
  readonly operationId: string;
  readonly kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE';
  readonly logicalPath: string;
  readonly state: DurableApplyMutationState;
  /** SHA-256 of baseline content, or "null" when absent. Never stores file bytes. */
  readonly baselineDigest: string;
  /** SHA-256 of written content when mutated, or "null". */
  readonly writtenDigest?: string;
}

export interface DurableApplyCheckpointDocument {
  readonly schemaVersion: typeof DURABLE_APPLY_CHECKPOINT_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly status: DurableApplyCheckpointStatus;
  readonly updatedAt: string;
  readonly operations: readonly DurableApplyCheckpointOperation[];
  readonly recoveryClassification: 'NONE' | 'RECOVERY_REQUIRED' | 'MANUAL_RECOVERY_REQUIRED';
}
