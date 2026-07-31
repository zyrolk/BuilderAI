import {
  PROVIDER_CAPABILITY_NAMES,
  PROVIDER_EXECUTION_MODES,
  InvalidProviderConfigurationError,
  type ProviderValidationIssue,
} from '../types';
import type { AIProviderConfiguration } from '../config';
import {
  addIssue,
  IDENTIFIER_PATTERN,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  validateExactKeys,
  validateStringArray,
} from './validation-helpers';

export class ProviderConfigurationValidator {
  validate(value: unknown): asserts value is AIProviderConfiguration {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        [
          'providerId',
          'enabled',
          'priority',
          'defaultTimeoutMs',
          'maximumTimeoutMs',
          'allowedExecutionModes',
          'requiredCapabilities',
        ],
        '$',
        issues,
      );
      if (typeof value.providerId !== 'string' || !IDENTIFIER_PATTERN.test(value.providerId)) {
        addIssue(issues, '$.providerId', 'must be a lowercase kebab-case identifier');
      }
      if (typeof value.enabled !== 'boolean') addIssue(issues, '$.enabled', 'must be a boolean');
      if (!isNonNegativeSafeInteger(value.priority)) {
        addIssue(issues, '$.priority', 'must be a non-negative safe integer');
      }
      if (!isPositiveSafeInteger(value.defaultTimeoutMs)) {
        addIssue(issues, '$.defaultTimeoutMs', 'must be a positive safe integer');
      }
      if (!isPositiveSafeInteger(value.maximumTimeoutMs)) {
        addIssue(issues, '$.maximumTimeoutMs', 'must be a positive safe integer');
      }
      if (
        isPositiveSafeInteger(value.defaultTimeoutMs) &&
        isPositiveSafeInteger(value.maximumTimeoutMs) &&
        value.defaultTimeoutMs > value.maximumTimeoutMs
      ) {
        addIssue(issues, '$.defaultTimeoutMs', 'must not exceed maximumTimeoutMs');
      }
      validateStringArray(
        value.allowedExecutionModes,
        PROVIDER_EXECUTION_MODES,
        '$.allowedExecutionModes',
        issues,
        false,
      );
      validateStringArray(
        value.requiredCapabilities,
        PROVIDER_CAPABILITY_NAMES,
        '$.requiredCapabilities',
        issues,
        true,
      );
    }
    if (issues.length > 0) throw new InvalidProviderConfigurationError(issues);
  }
}
