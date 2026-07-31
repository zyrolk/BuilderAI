import { isSafeLogicalPath } from '../../response-processor';
import type { FileApplyConfiguration } from '../config';
import { DEFAULT_FILE_APPLY_CONFIGURATION } from '../config';
import {
  FILE_APPLY_ERROR_CODES,
  FILE_APPLY_RESULT_SCHEMA_VERSION,
  FILE_APPLY_STATUSES,
  FileApplyValidationError,
  type FileApplyErrorCode,
  type FileApplyResult,
  type FileApplyStatus,
  type FileApplyValidationIssue,
} from '../types';
import { FileApplyConfigurationValidator } from './configuration.validator';
import {
  addIssue,
  isNonNegativeFiniteNumber,
  isRecord,
  isSorted,
  validateExactKeys,
  validateMetadata,
} from './validation-helpers';

export class FileApplyResultValidator {
  private readonly configurationValidator: FileApplyConfigurationValidator =
    new FileApplyConfigurationValidator();

  constructor(configuration: FileApplyConfiguration = DEFAULT_FILE_APPLY_CONFIGURATION) {
    this.configurationValidator.validate(configuration);
  }

  validate(value: unknown): asserts value is FileApplyResult {
    const issues: FileApplyValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new FileApplyValidationError([
        { code: 'INVALID_RESULT', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      [
        'schemaVersion',
        'status',
        'createdFiles',
        'updatedFiles',
        'deletedFiles',
        'skippedFiles',
        'warnings',
        'errors',
        'durationMs',
        'metadata',
      ],
      '$',
      issues,
    );
    if (value.schemaVersion !== FILE_APPLY_RESULT_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_RESULT_VERSION',
        '$.schemaVersion',
        `must equal ${FILE_APPLY_RESULT_SCHEMA_VERSION}`,
      );
    }
    if (!isFileApplyStatus(value.status)) {
      addIssue(issues, 'INVALID_RESULT', '$.status', 'is unsupported');
    }
    for (const key of ['createdFiles', 'updatedFiles', 'deletedFiles', 'skippedFiles'] as const) {
      this.validatePaths(value[key], `$.${key}`, issues);
    }
    this.validateWarnings(value.warnings, issues);
    this.validateErrors(value.errors, issues);
    if (!isNonNegativeFiniteNumber(value.durationMs)) {
      addIssue(issues, 'INVALID_RESULT', '$.durationMs', 'must be a non-negative finite number');
    }
    validateMetadata(value.metadata, '$.metadata', issues, 32, 2_000);
    if (issues.length === 0 && isFileApplyResultShape(value)) {
      this.validateRelationships(value, issues);
    }
    if (issues.length > 0) throw new FileApplyValidationError(issues);
  }

  private validatePaths(value: unknown, path: string, issues: FileApplyValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_RESULT', path, 'must be an array');
      return;
    }
    value.forEach((item, index) => {
      if (!isSafeLogicalPath(item)) {
        addIssue(issues, 'INVALID_PATH', `${path}[${index}]`, 'must be a safe logical path');
      }
    });
  }

  private validateWarnings(value: unknown, issues: FileApplyValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_RESULT', '$.warnings', 'must be an array');
      return;
    }
    value.forEach((warning, index) => {
      const path = `$.warnings[${index}]`;
      if (!isRecord(warning)) {
        addIssue(issues, 'INVALID_RESULT', path, 'must be an object');
        return;
      }
      validateExactKeys(warning, ['code', 'message'], path, issues);
      if (typeof warning.code !== 'string' || warning.code.length === 0) {
        addIssue(issues, 'INVALID_RESULT', `${path}.code`, 'must be non-empty');
      }
      if (typeof warning.message !== 'string' || warning.message.length === 0) {
        addIssue(issues, 'INVALID_RESULT', `${path}.message`, 'must be non-empty');
      }
    });
  }

  private validateErrors(value: unknown, issues: FileApplyValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_RESULT', '$.errors', 'must be an array');
      return;
    }
    value.forEach((error, index) => {
      const path = `$.errors[${index}]`;
      if (!isRecord(error)) {
        addIssue(issues, 'INVALID_RESULT', path, 'must be an object');
        return;
      }
      validateExactKeys(error, ['code', 'message', 'logicalPath', 'operationId'], path, issues);
      if (!isFileApplyErrorCode(error.code)) {
        addIssue(issues, 'INVALID_RESULT', `${path}.code`, 'is unsupported');
      }
      if (typeof error.message !== 'string' || error.message.length === 0) {
        addIssue(issues, 'INVALID_RESULT', `${path}.message`, 'must be non-empty');
      }
      if (error.logicalPath !== undefined && !isSafeLogicalPath(error.logicalPath)) {
        addIssue(issues, 'INVALID_PATH', `${path}.logicalPath`, 'must be a safe logical path');
      }
      if (
        error.operationId !== undefined &&
        (typeof error.operationId !== 'string' || error.operationId.length === 0)
      ) {
        addIssue(issues, 'INVALID_RESULT', `${path}.operationId`, 'must be non-empty');
      }
    });
  }

  private validateRelationships(value: FileApplyResult, issues: FileApplyValidationIssue[]): void {
    const pathCollections = [
      value.createdFiles,
      value.updatedFiles,
      value.deletedFiles,
      value.skippedFiles,
    ];
    const allPaths = pathCollections.flat();
    if (new Set(allPaths.map((path) => path.toLowerCase())).size !== allPaths.length) {
      addIssue(issues, 'INVALID_RESULT', '$', 'file result collections must be disjoint');
    }
    pathCollections.forEach((paths, index) => {
      if (!isSorted(paths)) {
        addIssue(
          issues,
          'INVALID_RESULT',
          `$.${['createdFiles', 'updatedFiles', 'deletedFiles', 'skippedFiles'][index]}`,
          'must use canonical order',
        );
      }
    });
    const warningKeys = value.warnings.map(({ code, message }) => `${code}\0${message}`);
    if (!isSorted(warningKeys)) {
      addIssue(issues, 'INVALID_RESULT', '$.warnings', 'must use canonical order');
    }
    const errorKeys = value.errors.map(
      ({ code, logicalPath, operationId, message }) =>
        `${code}\0${logicalPath ?? ''}\0${operationId ?? ''}\0${message}`,
    );
    if (!isSorted(errorKeys)) {
      addIssue(issues, 'INVALID_RESULT', '$.errors', 'must use canonical order');
    }
    if (!isSorted(Object.keys(value.metadata))) {
      addIssue(issues, 'INVALID_RESULT', '$.metadata', 'keys must use canonical order');
    }
    const appliedCount =
      value.createdFiles.length + value.updatedFiles.length + value.deletedFiles.length;
    if (value.status === 'APPLIED' && (value.errors.length > 0 || value.skippedFiles.length > 0)) {
      addIssue(
        issues,
        'INVALID_RESULT',
        '$.status',
        'APPLIED cannot contain errors or skipped files',
      );
    }
    if (value.status === 'REJECTED' && (appliedCount > 0 || value.errors.length === 0)) {
      addIssue(
        issues,
        'INVALID_RESULT',
        '$.status',
        'REJECTED requires errors and no applied files',
      );
    }
    if (value.status === 'FAILED' && (appliedCount > 0 || value.errors.length === 0)) {
      addIssue(issues, 'INVALID_RESULT', '$.status', 'FAILED requires errors and no applied files');
    }
    if (value.status === 'PARTIALLY_APPLIED' && (appliedCount === 0 || value.errors.length === 0)) {
      addIssue(
        issues,
        'INVALID_RESULT',
        '$.status',
        'PARTIALLY_APPLIED requires applied files and errors',
      );
    }
  }
}

function isFileApplyStatus(value: unknown): value is FileApplyStatus {
  return typeof value === 'string' && FILE_APPLY_STATUSES.some((status) => status === value);
}

function isFileApplyErrorCode(value: unknown): value is FileApplyErrorCode {
  return typeof value === 'string' && FILE_APPLY_ERROR_CODES.some((code) => code === value);
}

function isFileApplyResultShape(
  value: Record<string, unknown>,
): value is Record<string, unknown> & FileApplyResult {
  return (
    Array.isArray(value.createdFiles) &&
    Array.isArray(value.updatedFiles) &&
    Array.isArray(value.deletedFiles) &&
    Array.isArray(value.skippedFiles) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.errors) &&
    isRecord(value.metadata)
  );
}
