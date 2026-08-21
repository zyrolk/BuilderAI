import { createHash } from 'node:crypto';

/**
 * Captures pre-mutation file state for rollback after partial multi-file apply failure.
 * The implementation is responsible for reading file content through its own adapter.
 * Implementations must never expose file content in logs, errors, or provider prompts.
 */
export interface FileApplyCheckpointPort {
  /**
   * Optional durable binding for recovery classification. Does not authorize APPLY.
   */
  bindWorkflow?(workflowId: string): void | Promise<void>;

  /**
   * Captures the baseline of a file before mutation. For UPDATE/DELETE, reads and stores
   * the current content. For CREATE, records that the file did not exist.
   */
  captureBaseline(
    logicalPath: string,
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    currentContent: string | null,
    operationId?: string,
  ): void | Promise<void>;

  /**
   * Records the content written by a successful mutation, used to verify no external actor
   * has modified the file between BuilderAI's write and the rollback attempt.
   */
  recordMutationResult(
    logicalPath: string,
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    writtenContent: string | null,
    operationId?: string,
  ): void | Promise<void>;

  /**
   * Returns all captured entries in mutation order for rollback (reversed by caller).
   */
  entries(): readonly FileApplyCheckpointEntry[];

  /** Discards all captured state (and marks durable checkpoint complete when present). */
  clear(): void | Promise<void>;
}

export interface FileApplyCheckpointEntry {
  readonly logicalPath: string;
  readonly kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE';
  /** Original file content before mutation. Null means file did not exist (CREATE). */
  readonly baselineContent: string | null;
  /** Content BuilderAI wrote. Null means file was deleted. */
  readonly writtenContent: string | null;
}

export function digestCheckpointContent(content: string | null): string {
  if (content === null) return 'null';
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
