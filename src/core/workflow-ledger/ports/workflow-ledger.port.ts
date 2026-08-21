import type { WorkflowEvent, WorkflowEventInput } from '../types/workflow-event.types';
import type { WorkflowManifest } from '../types/workflow-ledger.types';
import type { ApplyRecoveryJournal } from '../types/apply-recovery-journal.types';
import type { RepositoryBaseline } from '../types/repository-baseline.types';
import type { WorkflowLease } from '../types/workflow-lease.types';

export interface AppendWorkflowEventInput extends WorkflowEventInput {
  readonly eventId: string;
  readonly timestamp: string;
}

export interface WorkflowLedgerPort {
  createWorkflow(input: {
    readonly workflowId: string;
    readonly projectId: string;
    readonly repositoryRoot: string;
    readonly originalRequest: string;
    readonly normalizedRequest?: string;
    readonly acceptanceCriteria?: string;
    readonly timestamp: string;
  }): Promise<WorkflowManifest>;

  appendEvent(input: AppendWorkflowEventInput): Promise<WorkflowEvent>;

  readManifest(workflowId: string): Promise<WorkflowManifest | undefined>;

  listWorkflows(projectId: string): Promise<readonly WorkflowManifest[]>;

  readEvents(workflowId: string): Promise<readonly WorkflowEvent[]>;

  saveBaseline(workflowId: string, baseline: RepositoryBaseline): Promise<void>;

  readBaseline(workflowId: string): Promise<RepositoryBaseline | undefined>;

  saveApplyJournal(workflowId: string, journal: ApplyRecoveryJournal): Promise<void>;

  readApplyJournal(workflowId: string): Promise<ApplyRecoveryJournal | undefined>;

  acquireLease(input: {
    readonly workflowId: string;
    readonly ownerIdentity: string;
    readonly acquiredAt: string;
    readonly expiresAt: string;
  }): Promise<WorkflowLease>;

  readLease(workflowId: string): Promise<WorkflowLease | undefined>;

  releaseLease(workflowId: string, ownerIdentity: string): Promise<void>;
}

export class WorkflowLedgerError extends Error {
  constructor(
    readonly code:
      | 'WORKFLOW_NOT_FOUND'
      | 'EVENT_CHAIN_INVALID'
      | 'EVENT_TAMPERED'
      | 'PERSISTENCE_FAILED'
      | 'LEASE_HELD'
      | 'LEASE_STALE'
      | 'INVALID_PATH'
      | 'CORRUPT_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowLedgerError';
  }
}
