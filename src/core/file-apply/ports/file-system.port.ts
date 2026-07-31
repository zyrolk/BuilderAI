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
  createFileIfAbsent(logicalPath: string, content: string): Promise<void>;
  updateFileIfRegularFile(logicalPath: string, content: string): Promise<void>;
  deleteFileIfRegularFile(logicalPath: string): Promise<void>;
}
