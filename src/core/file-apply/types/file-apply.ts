import type { ResponseMetadata } from '../../response-processor';

export const FILE_APPLY_RESULT_SCHEMA_VERSION = 1 as const;
export const FILE_APPLY_STATUSES = ['APPLIED', 'REJECTED', 'FAILED', 'PARTIALLY_APPLIED'] as const;

export const FILE_APPLY_ERROR_CODES = [
  'BASELINE_CONTENT_DRIFT',
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

/**
 * The single source of truth for "this Apply attempt provably touched the filesystem zero times"
 * (P1-6 / ADR-020). `REJECTED` always means zero mutations, since preflight completes before any
 * mutation is attempted. `FAILED` means execution began but only counts as zero-mutation when every
 * outcome array is empty, i.e. the very first operation failed before it could be recorded as applied.
 * `APPLIED` and `PARTIALLY_APPLIED` are never zero-mutation by definition and intentionally excluded.
 */
export function isZeroMutationFileApplyResult(result: FileApplyResult): boolean {
  if (result.status === 'REJECTED') return true;
  return (
    result.status === 'FAILED' &&
    result.createdFiles.length === 0 &&
    result.updatedFiles.length === 0 &&
    result.deletedFiles.length === 0
  );
}

/**
 * The single source of truth for "this Apply attempt actually mutated the workspace and therefore
 * requires verification evidence" (P1-7 / ADR-021). Eligibility is derived exclusively from `status`,
 * never from `skippedFiles` or any other indirect field: `APPLIED` and `PARTIALLY_APPLIED` both mean at
 * least one operation was actually applied to the filesystem (the validated `FileApplyResult` contract
 * requires `PARTIALLY_APPLIED` to have a non-empty applied count); `REJECTED` and `FAILED` both mean zero
 * mutations occurred (the same contract forbids either from having a non-empty applied count), so there
 * is nothing on disk to verify.
 */
export function isVerificationEligibleFileApplyResult(result: FileApplyResult): boolean {
  return result.status === 'APPLIED' || result.status === 'PARTIALLY_APPLIED';
}
