import type { ChangePlannerConfiguration } from '../config';
import { ChangePlanValidationError, type ChangePlanValidationIssue } from '../types';
import { addIssue, isPositiveSafeInteger, isRecord, validateExactKeys } from './validation-helpers';

function isUnitRatio(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

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
        'preservation',
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
    this.validatePreservation(value.preservation, issues);
    if (issues.length > 0) throw new ChangePlanValidationError(issues);
  }

  private validatePreservation(value: unknown, issues: ChangePlanValidationIssue[]): void {
    const path = '$.preservation';
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CONFIGURATION', path, 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      [
        'elevatedChurnThreshold',
        'highChurnThreshold',
        'maximumCrossFileChecks',
        'maximumListedHtmlIds',
      ],
      path,
      issues,
      'INVALID_CONFIGURATION',
    );
    if (!isUnitRatio(value.elevatedChurnThreshold)) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        `${path}.elevatedChurnThreshold`,
        'must be a finite number between 0 and 1 inclusive',
      );
    }
    if (!isUnitRatio(value.highChurnThreshold)) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        `${path}.highChurnThreshold`,
        'must be a finite number between 0 and 1 inclusive',
      );
    }
    if (
      isUnitRatio(value.elevatedChurnThreshold) &&
      isUnitRatio(value.highChurnThreshold) &&
      value.elevatedChurnThreshold >= value.highChurnThreshold
    ) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        `${path}.highChurnThreshold`,
        'must be greater than elevatedChurnThreshold',
      );
    }
    if (!isPositiveSafeInteger(value.maximumCrossFileChecks)) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        `${path}.maximumCrossFileChecks`,
        'must be a positive safe integer',
      );
    }
    if (!isPositiveSafeInteger(value.maximumListedHtmlIds)) {
      addIssue(
        issues,
        'INVALID_CONFIGURATION',
        `${path}.maximumListedHtmlIds`,
        'must be a positive safe integer',
      );
    }
  }
}
