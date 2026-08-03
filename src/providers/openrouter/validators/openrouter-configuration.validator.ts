import {
  InvalidProviderConfigurationError,
  type ProviderValidationIssue,
} from '../../../core/ai-provider';
import type { OpenRouterProviderConfiguration, OpenRouterProviderCredentials } from '../types';
import {
  addIssue,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  validateExactKeys,
} from './validation-helpers';

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;
const BASE_URL_PATTERN = /^https?:\/\/.+/;

export class OpenRouterConfigurationValidator {
  validate(value: unknown): asserts value is OpenRouterProviderConfiguration {
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

export class OpenRouterCredentialsValidator {
  validate(value: unknown): asserts value is OpenRouterProviderCredentials {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      const allowed = ['apiKey', 'baseUrl', 'httpReferer', 'appTitle'] as const;
      validateExactKeys(value, allowed, '$', issues);
      if (!isNonEmptyString(value.apiKey) || value.apiKey.length > 4_096) {
        addIssue(issues, '$.apiKey', 'must be a non-empty secret of at most 4096 characters');
      }
      if (!isNonEmptyString(value.baseUrl) || !BASE_URL_PATTERN.test(value.baseUrl)) {
        addIssue(issues, '$.baseUrl', 'must be a valid HTTP(S) base URL');
      }
      if (value.httpReferer !== undefined && !isNonEmptyString(value.httpReferer)) {
        addIssue(issues, '$.httpReferer', 'must be a non-empty string when present');
      }
      if (value.appTitle !== undefined && !isNonEmptyString(value.appTitle)) {
        addIssue(issues, '$.appTitle', 'must be a non-empty string when present');
      }
    }
    if (issues.length > 0) throw new InvalidProviderConfigurationError(issues);
  }
}
