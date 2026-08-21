import path from 'node:path';

import { digestCheckpointContent } from '../../core/file-apply/ports/file-apply-checkpoint.port';
import { WorkflowLedgerError } from '../../core/workflow-ledger';
import { assertSafeStatePath, readJsonFile, writeJsonAtomically } from './filesystem-safe-write';
import {
  DURABLE_APPLY_CHECKPOINT_SCHEMA_VERSION,
  type DurableApplyCheckpointDocument,
  type DurableApplyCheckpointOperation,
  type DurableApplyCheckpointStatus,
  type DurableApplyMutationState,
} from './durable-apply-checkpoint.types';

const CHECKPOINT_FILE = 'apply-checkpoint.json';

export class DurableApplyCheckpointStore {
  private workflowId: string | undefined;
  private operations: DurableApplyCheckpointOperation[] = [];
  private status: DurableApplyCheckpointStatus = 'CLEARED';

  constructor(
    private readonly stateRoot: string,
    private readonly projectId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async bindWorkflow(workflowId: string): Promise<void> {
    this.workflowId = workflowId;
    this.operations = [];
    this.status = 'IN_PROGRESS';
    await this.persist({
      recoveryClassification: 'RECOVERY_REQUIRED',
    });
  }

  async captureBaseline(
    logicalPath: string,
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    currentContent: string | null,
    operationId = `op-${this.operations.length}`,
  ): Promise<void> {
    this.requireWorkflow();
    const index = this.operations.length;
    this.operations = [
      ...this.operations,
      {
        index,
        operationId,
        kind,
        logicalPath,
        state: 'CAPTURED',
        baselineDigest: digestCheckpointContent(currentContent),
      },
    ];
    this.status = 'IN_PROGRESS';
    await this.persist({ recoveryClassification: 'RECOVERY_REQUIRED' });
  }

  async recordMutationResult(
    logicalPath: string,
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    writtenContent: string | null,
    operationId?: string,
  ): Promise<void> {
    this.requireWorkflow();
    const existingIndex = this.operations.findIndex(
      (entry) =>
        entry.logicalPath === logicalPath &&
        (operationId === undefined || entry.operationId === operationId),
    );
    if (existingIndex < 0) {
      this.operations = [
        ...this.operations,
        {
          index: this.operations.length,
          operationId: operationId ?? `op-${this.operations.length}`,
          kind,
          logicalPath,
          state: 'UNCERTAIN',
          baselineDigest: 'unknown',
          writtenDigest: digestCheckpointContent(writtenContent),
        },
      ];
    } else {
      const current = this.operations[existingIndex]!;
      const next = [...this.operations];
      next[existingIndex] = {
        ...current,
        state: 'MUTATED',
        writtenDigest: digestCheckpointContent(writtenContent),
      };
      this.operations = next;
    }
    this.status = 'IN_PROGRESS';
    await this.persist({ recoveryClassification: 'RECOVERY_REQUIRED' });
  }

  async markUncertain(logicalPath: string): Promise<void> {
    this.requireWorkflow();
    this.operations = this.operations.map((entry) =>
      entry.logicalPath === logicalPath
        ? { ...entry, state: 'UNCERTAIN' satisfies DurableApplyMutationState }
        : entry,
    );
    this.status = 'FAILED';
    await this.persist({ recoveryClassification: 'MANUAL_RECOVERY_REQUIRED' });
  }

  async complete(status: 'COMPLETED' | 'FAILED'): Promise<void> {
    if (this.workflowId === undefined) return;
    this.status = status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
    const uncertain = this.operations.some((entry) => entry.state === 'UNCERTAIN');
    await this.persist({
      recoveryClassification: uncertain
        ? 'MANUAL_RECOVERY_REQUIRED'
        : status === 'COMPLETED'
          ? 'NONE'
          : 'RECOVERY_REQUIRED',
    });
  }

  async clear(): Promise<void> {
    if (this.workflowId === undefined) return;
    this.status = 'CLEARED';
    this.operations = [];
    await this.persist({ recoveryClassification: 'NONE' });
    this.workflowId = undefined;
  }

  async load(workflowId: string): Promise<DurableApplyCheckpointDocument | undefined> {
    const filePath = this.checkpointPath(workflowId);
    try {
      await assertSafeStatePath(this.stateRoot, filePath);
    } catch {
      return undefined;
    }
    try {
      const document = await readJsonFile<DurableApplyCheckpointDocument>(filePath);
      if (document === undefined) return undefined;
      if (document.schemaVersion !== DURABLE_APPLY_CHECKPOINT_SCHEMA_VERSION) {
        throw new WorkflowLedgerError('CORRUPT_STATE', 'Apply checkpoint schema mismatch.');
      }
      return document;
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError) throw error;
      throw new WorkflowLedgerError('CORRUPT_STATE', 'Apply checkpoint is corrupt.');
    }
  }

  private requireWorkflow(): void {
    if (this.workflowId === undefined) {
      throw new WorkflowLedgerError('INVALID_PATH', 'Apply checkpoint is not bound to a workflow.');
    }
  }

  private async persist(input: {
    readonly recoveryClassification: DurableApplyCheckpointDocument['recoveryClassification'];
  }): Promise<void> {
    const workflowId = this.workflowId;
    if (workflowId === undefined) return;
    const document: DurableApplyCheckpointDocument = {
      schemaVersion: DURABLE_APPLY_CHECKPOINT_SCHEMA_VERSION,
      workflowId,
      status: this.status,
      updatedAt: this.now().toISOString(),
      operations: this.operations,
      recoveryClassification: input.recoveryClassification,
    };
    await writeJsonAtomically(this.stateRoot, this.checkpointPath(workflowId), document);
  }

  private checkpointPath(workflowId: string): string {
    return path.join(this.stateRoot, 'workflows', this.projectId, workflowId, CHECKPOINT_FILE);
  }
}
