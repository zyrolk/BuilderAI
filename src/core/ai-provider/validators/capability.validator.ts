import {
  AI_PROVIDER_CONTRACT_VERSION,
  ProviderContractViolationError,
  type AIProviderCapabilities,
  type AIProviderDescriptor,
  type ProviderValidationIssue,
} from '../types';
import {
  addIssue,
  IDENTIFIER_PATTERN,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  validateExactKeys,
} from './validation-helpers';

const BOOLEAN_CAPABILITIES = [
  'contextIngestion',
  'structuredOutput',
  'streaming',
  'toolCalling',
  'reasoning',
  'fileSupport',
  'imageSupport',
  'structuredResponses',
] as const;

export class ProviderCapabilityValidator {
  validate(value: unknown): asserts value is AIProviderCapabilities {
    const issues: ProviderValidationIssue[] = [];
    validateCapabilities(value, '$', issues);
    if (issues.length > 0) throw new ProviderContractViolationError('CAPABILITIES', issues);
  }
}

export class ProviderDescriptorValidator {
  validate(value: unknown): asserts value is AIProviderDescriptor {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        ['contractVersion', 'id', 'displayName', 'capabilities'],
        '$',
        issues,
      );
      if (value.contractVersion !== AI_PROVIDER_CONTRACT_VERSION) {
        addIssue(issues, '$.contractVersion', `must equal ${AI_PROVIDER_CONTRACT_VERSION}`);
      }
      if (!isNonEmptyString(value.id) || !IDENTIFIER_PATTERN.test(value.id)) {
        addIssue(issues, '$.id', 'must be a lowercase kebab-case identifier');
      }
      if (!isNonEmptyString(value.displayName)) addIssue(issues, '$.displayName', 'is required');
      validateCapabilities(value.capabilities, '$.capabilities', issues);
    }
    if (issues.length > 0) throw new ProviderContractViolationError('DESCRIPTOR', issues);
  }
}

function validateCapabilities(
  value: unknown,
  path: string,
  issues: ProviderValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object');
    return;
  }
  validateExactKeys(value, [...BOOLEAN_CAPABILITIES, 'maximumContextCharacters'], path, issues);
  for (const capability of BOOLEAN_CAPABILITIES) {
    if (typeof value[capability] !== 'boolean') {
      addIssue(issues, `${path}.${capability}`, 'must be a boolean');
    }
  }
  if (!isPositiveSafeInteger(value.maximumContextCharacters)) {
    addIssue(issues, `${path}.maximumContextCharacters`, 'must be a positive safe integer');
  }
}
