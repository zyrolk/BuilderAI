import type { ExecutionEngineConfiguration } from '../config';
import { ExecutionEngineValidationError, type ExecutionValidationIssue } from '../types';
import {
  addIssue,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  validateExactKeys,
} from './validation-helpers';

export class ExecutionEngineConfigurationValidator {
  validate(value: unknown): asserts value is ExecutionEngineConfiguration {
    const issues: ExecutionValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_EXECUTION_POLICY', '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        ['maximumRetries', 'maximumTimeoutMs', 'maximumRetryDelayMs', 'maximumMetadataEntries'],
        '$',
        issues,
        'INVALID_EXECUTION_POLICY',
      );
      if (!isNonNegativeSafeInteger(value.maximumRetries)) {
        addIssue(
          issues,
          'INVALID_EXECUTION_POLICY',
          '$.maximumRetries',
          'must be a non-negative safe integer',
        );
      }
      for (const field of [
        'maximumTimeoutMs',
        'maximumRetryDelayMs',
        'maximumMetadataEntries',
      ] as const) {
        if (!isPositiveSafeInteger(value[field])) {
          addIssue(
            issues,
            'INVALID_EXECUTION_POLICY',
            `$.${field}`,
            'must be a positive safe integer',
          );
        }
      }
    }
    if (issues.length > 0) throw new ExecutionEngineValidationError(issues);
  }
}
