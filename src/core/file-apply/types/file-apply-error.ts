import type { FileApplyValidationIssue } from './file-apply';

export class FileApplyValidationError extends Error {
  readonly code = 'FILE_APPLY_VALIDATION_FAILED' as const;

  constructor(readonly issues: readonly FileApplyValidationIssue[]) {
    super(
      `File apply validation failed: ${issues
        .map(({ path, message }) => `${path} ${message}`)
        .join('; ')}.`,
    );
    this.name = 'FileApplyValidationError';
  }
}

export class FileSystemPortError extends Error {
  constructor(
    readonly code: 'INSPECTION_FAILED' | 'CREATE_FAILED' | 'UPDATE_FAILED' | 'DELETE_FAILED',
    readonly logicalPath: string,
    message = 'Filesystem operation failed',
  ) {
    super(message);
    this.name = 'FileSystemPortError';
  }
}
