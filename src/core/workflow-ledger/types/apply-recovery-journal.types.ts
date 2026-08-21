export const APPLY_RECOVERY_JOURNAL_SCHEMA_VERSION = 1 as const;

export const APPLY_OPERATION_STATES = [
  'PENDING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK',
  'UNCERTAIN',
] as const;

export type ApplyOperationState = (typeof APPLY_OPERATION_STATES)[number];

export const APPLY_RECOVERY_STATES = [
  'NO_MUTATION',
  'MUTATION_COMPLETED',
  'ROLLBACK_COMPLETED',
  'MUTATION_UNCERTAIN',
  'MANUAL_RECOVERY_REQUIRED',
] as const;

export type ApplyRecoveryState = (typeof APPLY_RECOVERY_STATES)[number];

export const APPLY_ROLLBACK_STATES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'UNCERTAIN',
] as const;

export type ApplyRollbackState = (typeof APPLY_ROLLBACK_STATES)[number];

export interface ApplyRecoveryJournalEntry {
  readonly operationId: string;
  readonly operationType: string;
  readonly logicalPath: string;
  readonly baselineChecksum?: string;
  readonly expectedPostWriteChecksum?: string;
  readonly operationState: ApplyOperationState;
  readonly timestamp: string;
  readonly rollbackState: ApplyRollbackState;
}

export interface ApplyRecoveryJournal {
  readonly schemaVersion: typeof APPLY_RECOVERY_JOURNAL_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly preparationId: string;
  readonly applyStartedAt: string;
  readonly applyCompletedAt?: string;
  readonly recoveryState: ApplyRecoveryState;
  readonly entries: readonly ApplyRecoveryJournalEntry[];
}
