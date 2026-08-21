import type {
  FileApplyCheckpointEntry,
  FileApplyCheckpointPort,
} from '../ports/file-apply-checkpoint.port';

export class InMemoryFileApplyCheckpoint implements FileApplyCheckpointPort {
  private readonly captured: Array<{
    logicalPath: string;
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE';
    baselineContent: string | null;
    writtenContent: string | null;
    mutationCompleted: boolean;
  }> = [];

  captureBaseline(
    logicalPath: string,
    kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    currentContent: string | null,
  ): void {
    this.captured.push({
      logicalPath,
      kind,
      baselineContent: currentContent,
      writtenContent: null,
      mutationCompleted: false,
    });
  }

  recordMutationResult(
    logicalPath: string,
    _kind: 'CREATE_FILE' | 'UPDATE_FILE' | 'DELETE_FILE',
    writtenContent: string | null,
  ): void {
    const entry = this.captured.find((e) => e.logicalPath === logicalPath);
    if (entry !== undefined) {
      entry.writtenContent = writtenContent;
      entry.mutationCompleted = true;
    }
  }

  entries(): readonly FileApplyCheckpointEntry[] {
    return this.captured.filter((e) => e.mutationCompleted).map((e) => ({ ...e }));
  }

  clear(): void {
    this.captured.length = 0;
  }
}
