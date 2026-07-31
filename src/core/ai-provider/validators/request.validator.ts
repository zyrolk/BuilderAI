import {
  PROMPT_PACKAGE_SCHEMA_VERSION,
  PromptOrchestratorValidationError,
  PromptPackageValidator,
  type PromptPackage,
} from '../../prompt-orchestrator';
import {
  AI_PROVIDER_CONTRACT_VERSION,
  PROVIDER_ARTIFACT_KINDS,
  PROVIDER_CAPABILITY_NAMES,
  PROVIDER_EXECUTION_MODES,
  ProviderContractViolationError,
  type AIProviderRequest,
  type ProviderValidationIssue,
} from '../types';
import {
  addIssue,
  IDENTIFIER_PATTERN,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  validateMetadata,
  validateExactKeys,
  validateStringArray,
} from './validation-helpers';

export class ProviderRequestValidator {
  private readonly promptValidator: PromptPackageValidator = new PromptPackageValidator();

  validate(value: unknown): asserts value is AIProviderRequest {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        [
          'contractVersion',
          'requestId',
          'prompt',
          'executionMode',
          'constraints',
          'timeoutMs',
          'cancellation',
          'metadata',
        ],
        '$',
        issues,
      );
      if (value.contractVersion !== AI_PROVIDER_CONTRACT_VERSION) {
        addIssue(issues, '$.contractVersion', `must equal ${AI_PROVIDER_CONTRACT_VERSION}`);
      }
      if (!isNonEmptyString(value.requestId) || !IDENTIFIER_PATTERN.test(value.requestId)) {
        addIssue(issues, '$.requestId', 'must be a lowercase kebab-case identifier');
      }
      this.validatePrompt(value.prompt, issues);
      if (!PROVIDER_EXECUTION_MODES.includes(value.executionMode as never)) {
        addIssue(issues, '$.executionMode', 'is unsupported');
      }
      this.validateConstraints(value.constraints, issues);
      if (!isPositiveSafeInteger(value.timeoutMs)) {
        addIssue(issues, '$.timeoutMs', 'must be a positive safe integer');
      }
      this.validateCancellation(value.cancellation, issues);
      validateMetadata(value.metadata, '$.metadata', issues);
    }
    if (issues.length > 0) throw new ProviderContractViolationError('REQUEST', issues);
  }

  private validatePrompt(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!hasPromptPackageShape(value)) {
      addIssue(issues, '$.prompt', 'must be a Prompt Package with valid budget metadata');
      return;
    }
    try {
      this.promptValidator.validate(value);
    } catch (error: unknown) {
      if (error instanceof PromptOrchestratorValidationError) {
        for (const issue of error.issues) {
          addIssue(issues, `$.prompt${issue.path.slice(1)}`, issue.message);
        }
        return;
      }
      addIssue(issues, '$.prompt', 'could not be validated as a Prompt Package');
    }
  }

  private validateConstraints(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, '$.constraints', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      [
        'maximumOutputCharacters',
        'requiredArtifactKinds',
        'requiredCapabilities',
        'requireStructuredResponse',
      ],
      '$.constraints',
      issues,
    );
    if (!isPositiveSafeInteger(value.maximumOutputCharacters)) {
      addIssue(issues, '$.constraints.maximumOutputCharacters', 'must be a positive safe integer');
    }
    validateStringArray(
      value.requiredArtifactKinds,
      PROVIDER_ARTIFACT_KINDS,
      '$.constraints.requiredArtifactKinds',
      issues,
      true,
    );
    validateStringArray(
      value.requiredCapabilities,
      PROVIDER_CAPABILITY_NAMES,
      '$.constraints.requiredCapabilities',
      issues,
      true,
    );
    if (typeof value.requireStructuredResponse !== 'boolean') {
      addIssue(issues, '$.constraints.requireStructuredResponse', 'must be a boolean');
    }
  }

  private validateCancellation(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!isRecord(value) || typeof value.cancelled !== 'boolean') {
      addIssue(issues, '$.cancellation', 'must contain a boolean cancelled flag');
      return;
    }
    validateExactKeys(value, ['cancelled', 'reason', 'subscribe'], '$.cancellation', issues);
    if (value.reason !== undefined && !isNonEmptyString(value.reason)) {
      addIssue(issues, '$.cancellation.reason', 'must be a non-empty string when present');
    }
    if (typeof value.subscribe !== 'function') {
      addIssue(issues, '$.cancellation.subscribe', 'must be a cancellation subscription function');
    }
  }
}

function hasPromptPackageShape(value: unknown): value is PromptPackage {
  return (
    isRecord(value) &&
    value.schemaVersion === PROMPT_PACKAGE_SCHEMA_VERSION &&
    isRecord(value.template) &&
    Array.isArray(value.sections) &&
    isRecord(value.metadata) &&
    isRecord(value.budget) &&
    isPositiveSafeInteger(value.budget.maximumCharacters) &&
    typeof value.budget.characters === 'number' &&
    Array.isArray(value.budget.omittedSections)
  );
}
