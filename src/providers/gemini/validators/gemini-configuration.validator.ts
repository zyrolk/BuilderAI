import {
  InvalidProviderConfigurationError,
  type ProviderValidationIssue,
} from '../../../core/ai-provider';
import type { GeminiProviderConfiguration, GeminiProviderCredentials } from '../types';
import {
  addIssue,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  validateExactKeys,
} from './validation-helpers';

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;

export class GeminiConfigurationValidator {
  validate(value: unknown): asserts value is GeminiProviderConfiguration {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        [
          'model',
          'defaultTimeoutMs',
          'maximumTimeoutMs',
          'maximumInputCharacters',
          'maximumOutputCharacters',
          'maximumOutputTokens',
        ],
        '$',
        issues,
      );
      if (!isNonEmptyString(value.model) || !MODEL_PATTERN.test(value.model)) {
        addIssue(issues, '$.model', 'must be a valid non-empty model identifier');
      }
      for (const field of [
        'defaultTimeoutMs',
        'maximumTimeoutMs',
        'maximumInputCharacters',
        'maximumOutputCharacters',
        'maximumOutputTokens',
      ] as const) {
        if (!isPositiveSafeInteger(value[field])) {
          addIssue(issues, `$.${field}`, 'must be a positive safe integer');
        }
      }
      if (
        isPositiveSafeInteger(value.defaultTimeoutMs) &&
        isPositiveSafeInteger(value.maximumTimeoutMs) &&
        value.defaultTimeoutMs > value.maximumTimeoutMs
      ) {
        addIssue(issues, '$.defaultTimeoutMs', 'must not exceed maximumTimeoutMs');
      }
    }
    if (issues.length > 0) throw new InvalidProviderConfigurationError(issues);
  }
}

export class GeminiCredentialsValidator {
  validate(value: unknown): asserts value is GeminiProviderCredentials {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      validateExactKeys(value, ['apiKey'], '$', issues);
      if (!isNonEmptyString(value.apiKey) || value.apiKey.length > 4_096) {
        addIssue(issues, '$.apiKey', 'must be a non-empty secret of at most 4096 characters');
      }
    }
    if (issues.length > 0) throw new InvalidProviderConfigurationError(issues);
  }
}
