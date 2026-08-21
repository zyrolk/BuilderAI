import type { ArtifactChecksum } from '../../response-processor';

export const FILE_SYSTEM_ENTRY_KINDS = ['FILE', 'DIRECTORY', 'SYMLINK', 'OTHER'] as const;
export type FileSystemEntryKind = (typeof FILE_SYSTEM_ENTRY_KINDS)[number];

export interface FileSystemEntry {
  readonly kind: FileSystemEntryKind;
}

/**
 * A root-scoped filesystem capability. Implementations must contain every logical path beneath the
 * configured project root, reject symlink traversal, and make each mutation conditional on the
 * precondition stated by its method name.
 */
export interface FileSystemPort {
  inspect(logicalPath: string): Promise<FileSystemEntry | null>;
  inspectParentDirectory(logicalPath: string): Promise<FileSystemEntry | null>;
  /**
   * Reads the current on-disk text baseline checksum for drift detection. Uses the same CRLF/LF
   * normalization and SHA-256 semantics as prepare-time baseline capture. Returns null when the
   * target is missing, not a regular file, unreadable, binary, oversize, or symlinked.
   */
  readRegularFileBaselineChecksum(logicalPath: string): Promise<ArtifactChecksum | null>;
  /**
   * Reads the current text content for checkpoint/rollback purposes. Returns null when the target
   * is missing, not a regular file, unreadable, binary, oversize, or symlinked.
   */
  readRegularFileContent?(logicalPath: string): Promise<string | null>;
  createFileIfAbsent(logicalPath: string, content: string): Promise<void>;
  updateFileIfRegularFile(logicalPath: string, content: string): Promise<void>;
  deleteFileIfRegularFile(logicalPath: string): Promise<void>;
}
