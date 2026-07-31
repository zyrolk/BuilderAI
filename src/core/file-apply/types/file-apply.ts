import type { ResponseMetadata } from '../../response-processor';

export const FILE_APPLY_RESULT_SCHEMA_VERSION = 1 as const;
export const FILE_APPLY_STATUSES = ['APPLIED', 'REJECTED', 'FAILED', 'PARTIALLY_APPLIED'] as const;

export const FILE_APPLY_ERROR_CODES = [
  'FILESYSTEM_INSPECTION_FAILED',
  'FILESYSTEM_OPERATION_FAILED',
  'INVALID_CHANGE_PLAN',
  'INVALID_CONFIGURATION',
  'INVALID_PATH',
  'INVALID_RESULT',
  'PARENT_DIRECTORY_MISSING',
  'PARENT_NOT_DIRECTORY',
  'PROTECTED_PATH',
  'SYMLINK_REJECTED',
  'TARGET_ALREADY_EXISTS',
  'TARGET_MISSING',
  'TARGET_NOT_FILE',
  'UNSUPPORTED_RESULT_VERSION',
] as const;

export type FileApplyStatus = (typeof FILE_APPLY_STATUSES)[number];

export type FileApplyErrorCode = (typeof FILE_APPLY_ERROR_CODES)[number];

export interface FileApplyWarning {
  readonly code: string;
  readonly message: string;
}

export interface FileApplyError {
  readonly code: FileApplyErrorCode;
  readonly message: string;
  readonly logicalPath?: string;
  readonly operationId?: string;
}

export interface FileApplyResult {
  readonly schemaVersion: typeof FILE_APPLY_RESULT_SCHEMA_VERSION;
  readonly status: FileApplyStatus;
  readonly createdFiles: readonly string[];
  readonly updatedFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly skippedFiles: readonly string[];
  readonly warnings: readonly FileApplyWarning[];
  readonly errors: readonly FileApplyError[];
  readonly durationMs: number;
  readonly metadata: ResponseMetadata;
}

export interface FileApplyValidationIssue {
  readonly code: FileApplyErrorCode;
  readonly path: string;
  readonly message: string;
}
