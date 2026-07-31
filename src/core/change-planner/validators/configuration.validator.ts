import type { ChangePlannerConfiguration } from '../config';
import { ChangePlanValidationError, type ChangePlanValidationIssue } from '../types';
import { addIssue, isPositiveSafeInteger, isRecord, validateExactKeys } from './validation-helpers';

export class ChangePlannerConfigurationValidator {
  validate(value: unknown): asserts value is ChangePlannerConfiguration {
    const issues: ChangePlanValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new ChangePlanValidationError([
        { code: 'INVALID_CONFIGURATION', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      [
        'maximumOperations',
        'maximumMetadataEntries',
        'maximumMetadataStringCharacters',
        'broadChangeOperationThreshold',
      ],
      '$',
      issues,
      'INVALID_CONFIGURATION',
    );
    for (const key of [
      'maximumOperations',
      'maximumMetadataEntries',
      'maximumMetadataStringCharacters',
      'broadChangeOperationThreshold',
    ] as const) {
      if (!isPositiveSafeInteger(value[key])) {
        addIssue(issues, 'INVALID_CONFIGURATION', `$.${key}`, 'must be a positive safe integer');
      }
    }
    if (
      isPositiveSafeInteger(value.maximumOperations) &&
      isPositiveSafeInteger(value.broadChangeOperationThreshold) &&
      value.broadChangeOperationThreshold > value.maximumOperations
    ) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        '$.broadChangeOperationThreshold',
        'must not exceed maximumOperations',
      );
    }
    if (issues.length > 0) throw new ChangePlanValidationError(issues);
  }
}
