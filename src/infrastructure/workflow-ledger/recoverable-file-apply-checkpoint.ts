import type {
  FileApplyCheckpointEntry,
  FileApplyCheckpointPort,
} from '../../core/file-apply/ports/file-apply-checkpoint.port';
import { InMemoryCheckpointService } from '../../core/file-apply/services/in-memory-checkpoint.service';
import type { DurableApplyCheckpointStore } from './durable-apply-checkpoint.store';

/**
 * In-process rollback content (memory) + durable mutation metadata (state root).
 * Durable store never receives file contents — only digests/paths/state.
 * `clear()` clears memory only so mid-apply crash evidence remains on disk.
 */
export class RecoverableFileApplyCheckpoint implements FileApplyCheckpointPort {
  private readonly memory = new InMemoryCheckpointService();

  constructor(private readonly durable: DurableApplyCheckpointStore) {}

  async bindWorkflow(workflowId: string): Promise<void> {
    await this.durable.bindWorkflow(workflowId);
  }

  async captureBaseline(
    logicalPath: string,
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    currentContent: string | null,
    operationId?: string,
  ): Promise<void> {
    this.memory.captureBaseline(logicalPath, kind, currentContent);
    await this.durable.captureBaseline(logicalPath, kind, currentContent, operationId);
  }

  async recordMutationResult(
    logicalPath: string,
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    writtenContent: string | null,
    operationId?: string,
  ): Promise<void> {
    this.memory.recordMutationResult(logicalPath, kind, writtenContent);
    await this.durable.recordMutationResult(logicalPath, kind, writtenContent, operationId);
  }

  entries(): readonly FileApplyCheckpointEntry[] {
    return this.memory.entries();
  }

  async clear(): Promise<void> {
    this.memory.clear();
  }

  async finish(status: 'COMPLETED' | 'FAILED'): Promise<void> {
    this.memory.clear();
    await this.durable.complete(status);
  }

  getDurableStore(): DurableApplyCheckpointStore {
    return this.durable;
  }
}
