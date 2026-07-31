import type { ExecutionEngineConfiguration } from '../config';
import {
  EXECUTION_FAILURE_STRATEGIES,
  EXECUTION_PRIORITIES,
  EXECUTION_VALIDATION_MODES,
  RETRY_DELAY_STRATEGIES,
  TIMEOUT_START_STATES,
  ExecutionEngineValidationError,
  type ExecutionPolicy,
  type ExecutionRetryPolicy,
  type ExecutionTimeoutPolicy,
  type ExecutionValidationIssue,
} from '../types';
import {
  addIssue,
  duplicates,
  EXECUTION_ERROR_CODE_PATTERN,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  validateExactKeys,
} from './validation-helpers';

export class ExecutionPolicyValidator {
  validate(value: unknown, limits: ExecutionEngineConfiguration): asserts value is ExecutionPolicy {
    const issues: ExecutionValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_EXECUTION_POLICY', '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        ['priority', 'validationMode', 'failureStrategy', 'retry', 'timeout'],
        '$',
        issues,
        'INVALID_EXECUTION_POLICY',
      );
      if (!EXECUTION_PRIORITIES.includes(value.priority as never)) {
        addIssue(issues, 'INVALID_EXECUTION_POLICY', '$.priority', 'is unsupported');
      }
      if (!EXECUTION_VALIDATION_MODES.includes(value.validationMode as never)) {
        addIssue(issues, 'INVALID_EXECUTION_POLICY', '$.validationMode', 'is unsupported');
      }
      if (!EXECUTION_FAILURE_STRATEGIES.includes(value.failureStrategy as never)) {
        addIssue(issues, 'INVALID_EXECUTION_POLICY', '$.failureStrategy', 'is unsupported');
      }
      this.validateRetry(value.retry, value.failureStrategy, limits, issues);
      this.validateTimeout(value.timeout, limits, issues);
    }
    if (issues.length > 0) throw new ExecutionEngineValidationError(issues);
  }

  private validateRetry(
    value: unknown,
    failureStrategy: unknown,
    limits: ExecutionEngineConfiguration,
    issues: ExecutionValidationIssue[],
  ): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_RETRY_POLICY', '$.retry', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['maximumRetries', 'delayStrategy', 'baseDelayMs', 'maximumDelayMs', 'retryableErrorCodes'],
      '$.retry',
      issues,
      'INVALID_RETRY_POLICY',
    );
    if (
      !isNonNegativeSafeInteger(value.maximumRetries) ||
      value.maximumRetries > limits.maximumRetries
    ) {
      addIssue(
        issues,
        'INVALID_RETRY_POLICY',
        '$.retry.maximumRetries',
        `must be between 0 and ${limits.maximumRetries}`,
      );
    }
    if (!RETRY_DELAY_STRATEGIES.includes(value.delayStrategy as never)) {
      addIssue(issues, 'INVALID_RETRY_POLICY', '$.retry.delayStrategy', 'is unsupported');
    }
    if (!isNonNegativeSafeInteger(value.baseDelayMs)) {
      addIssue(issues, 'INVALID_RETRY_POLICY', '$.retry.baseDelayMs', 'must be non-negative');
    }
    if (
      !isNonNegativeSafeInteger(value.maximumDelayMs) ||
      value.maximumDelayMs > limits.maximumRetryDelayMs
    ) {
      addIssue(
        issues,
        'INVALID_RETRY_POLICY',
        '$.retry.maximumDelayMs',
        `must be between 0 and ${limits.maximumRetryDelayMs}`,
      );
    }
    if (
      isNonNegativeSafeInteger(value.baseDelayMs) &&
      isNonNegativeSafeInteger(value.maximumDelayMs) &&
      value.baseDelayMs > value.maximumDelayMs
    ) {
      addIssue(
        issues,
        'INVALID_RETRY_POLICY',
        '$.retry.baseDelayMs',
        'must not exceed maximumDelayMs',
      );
    }
    this.validateRetryableCodes(value.retryableErrorCodes, issues);
    if (isExecutionRetryPolicy(value)) {
      this.validateRetryCombination(value, failureStrategy, issues);
    }
  }

  private validateRetryableCodes(value: unknown, issues: ExecutionValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_RETRY_POLICY', '$.retry.retryableErrorCodes', 'must be an array');
      return;
    }
    const codes = value.filter((entry): entry is string => typeof entry === 'string');
    if (
      codes.length !== value.length ||
      codes.some((code) => !EXECUTION_ERROR_CODE_PATTERN.test(code))
    ) {
      addIssue(
        issues,
        'INVALID_RETRY_POLICY',
        '$.retry.retryableErrorCodes',
        'must contain only uppercase error codes',
      );
    }
    for (const duplicate of duplicates(codes)) {
      addIssue(
        issues,
        'INVALID_RETRY_POLICY',
        '$.retry.retryableErrorCodes',
        `contains duplicate '${duplicate}'`,
      );
    }
  }

  private validateRetryCombination(
    retry: ExecutionRetryPolicy,
    failureStrategy: unknown,
    issues: ExecutionValidationIssue[],
  ): void {
    const disabled = retry.maximumRetries === 0;
    if (
      disabled &&
      (retry.delayStrategy !== 'NONE' ||
        retry.baseDelayMs !== 0 ||
        retry.maximumDelayMs !== 0 ||
        retry.retryableErrorCodes.length !== 0)
    ) {
      addIssue(issues, 'INVALID_RETRY_POLICY', '$.retry', 'disabled retries must use zero values');
    }
    if (
      !disabled &&
      (retry.delayStrategy === 'NONE' ||
        retry.baseDelayMs <= 0 ||
        retry.maximumDelayMs <= 0 ||
        retry.retryableErrorCodes.length === 0)
    ) {
      addIssue(
        issues,
        'INVALID_RETRY_POLICY',
        '$.retry',
        'enabled retries require delay and codes',
      );
    }
    if (failureStrategy === 'FAIL_FAST' && !disabled) {
      addIssue(
        issues,
        'INVALID_EXECUTION_POLICY',
        '$.failureStrategy',
        'requires retries disabled',
      );
    }
    if (failureStrategy === 'RETRY_THEN_FAIL' && disabled) {
      addIssue(issues, 'INVALID_EXECUTION_POLICY', '$.failureStrategy', 'requires retries enabled');
    }
  }

  private validateTimeout(
    value: unknown,
    limits: ExecutionEngineConfiguration,
    issues: ExecutionValidationIssue[],
  ): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_TIMEOUT_POLICY', '$.timeout', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['durationMs', 'startsAt'],
      '$.timeout',
      issues,
      'INVALID_TIMEOUT_POLICY',
    );
    if (!isPositiveSafeInteger(value.durationMs) || value.durationMs > limits.maximumTimeoutMs) {
      addIssue(
        issues,
        'INVALID_TIMEOUT_POLICY',
        '$.timeout.durationMs',
        `must be between 1 and ${limits.maximumTimeoutMs}`,
      );
    }
    if (!TIMEOUT_START_STATES.includes(value.startsAt as never)) {
      addIssue(issues, 'INVALID_TIMEOUT_POLICY', '$.timeout.startsAt', 'is unsupported');
    }
  }
}

export function isExecutionTimeoutPolicy(value: unknown): value is ExecutionTimeoutPolicy {
  return (
    isRecord(value) &&
    isPositiveSafeInteger(value.durationMs) &&
    TIMEOUT_START_STATES.includes(value.startsAt as never)
  );
}

function isExecutionRetryPolicy(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ExecutionRetryPolicy {
  return (
    isNonNegativeSafeInteger(value.maximumRetries) &&
    RETRY_DELAY_STRATEGIES.includes(value.delayStrategy as never) &&
    isNonNegativeSafeInteger(value.baseDelayMs) &&
    isNonNegativeSafeInteger(value.maximumDelayMs) &&
    Array.isArray(value.retryableErrorCodes) &&
    value.retryableErrorCodes.every((entry) => typeof entry === 'string')
  );
}
