import {
  PromptOrchestratorValidationError,
  PromptPackageValidator,
} from '../../prompt-orchestrator';
import {
  DEFAULT_EXECUTION_ENGINE_CONFIGURATION,
  type ExecutionEngineConfiguration,
} from '../config';
import {
  EXECUTION_REQUEST_SCHEMA_VERSION,
  ExecutionEngineValidationError,
  type ExecutionRequest,
  type ExecutionValidationIssue,
} from '../types';
import { ExecutionEngineConfigurationValidator } from './configuration.validator';
import { ExecutionPolicyValidator } from './execution-policy.validator';
import {
  addIssue,
  EXECUTION_IDENTIFIER_PATTERN,
  isNonEmptyString,
  isRecord,
  parseIsoTimestamp,
  validateExactKeys,
  validateScalarMetadata,
} from './validation-helpers';

export class ExecutionRequestValidator {
  private readonly configurationValidator: ExecutionEngineConfigurationValidator =
    new ExecutionEngineConfigurationValidator();
  private readonly policyValidator: ExecutionPolicyValidator = new ExecutionPolicyValidator();
  private readonly promptValidator: PromptPackageValidator = new PromptPackageValidator();

  constructor(
    private readonly limits: ExecutionEngineConfiguration = DEFAULT_EXECUTION_ENGINE_CONFIGURATION,
  ) {
    this.configurationValidator.validate(limits);
  }

  validate(value: unknown): asserts value is ExecutionRequest {
    const issues: ExecutionValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_EXECUTION_REQUEST', '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        ['schemaVersion', 'executionId', 'prompt', 'metadata', 'policy', 'cancellation'],
        '$',
        issues,
        'INVALID_EXECUTION_REQUEST',
      );
      if (value.schemaVersion !== EXECUTION_REQUEST_SCHEMA_VERSION) {
        addIssue(
          issues,
          'UNSUPPORTED_EXECUTION_VERSION',
          '$.schemaVersion',
          `must equal ${EXECUTION_REQUEST_SCHEMA_VERSION}`,
        );
      }
      if (
        !isNonEmptyString(value.executionId) ||
        !EXECUTION_IDENTIFIER_PATTERN.test(value.executionId)
      ) {
        addIssue(
          issues,
          'INVALID_EXECUTION_REQUEST',
          '$.executionId',
          'must be a lowercase kebab-case identifier',
        );
      }
      this.validatePrompt(value.prompt, issues);
      this.validateMetadata(value.metadata, issues);
      try {
        this.policyValidator.validate(value.policy, this.limits);
      } catch (error: unknown) {
        if (error instanceof ExecutionEngineValidationError) {
          for (const issue of error.issues) {
            issues.push({ ...issue, path: `$.policy${issue.path.slice(1)}` });
          }
        } else {
          throw error;
        }
      }
      this.validateCancellation(value.cancellation, issues);
    }
    if (issues.length > 0) throw new ExecutionEngineValidationError(issues);
  }

  private validatePrompt(value: unknown, issues: ExecutionValidationIssue[]): void {
    try {
      this.promptValidator.validate(value);
    } catch (error: unknown) {
      if (error instanceof PromptOrchestratorValidationError) {
        for (const issue of error.issues) {
          addIssue(
            issues,
            'INVALID_EXECUTION_REQUEST',
            `$.prompt${issue.path.slice(1)}`,
            issue.message,
          );
        }
      } else {
        addIssue(issues, 'INVALID_EXECUTION_REQUEST', '$.prompt', 'could not be validated');
      }
    }
  }

  private validateMetadata(value: unknown, issues: ExecutionValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_EXECUTION_REQUEST', '$.metadata', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['correlationId', 'requestedAt', 'values'],
      '$.metadata',
      issues,
      'INVALID_EXECUTION_REQUEST',
    );
    if (
      !isNonEmptyString(value.correlationId) ||
      !EXECUTION_IDENTIFIER_PATTERN.test(value.correlationId)
    ) {
      addIssue(
        issues,
        'INVALID_EXECUTION_REQUEST',
        '$.metadata.correlationId',
        'must be a lowercase kebab-case identifier',
      );
    }
    if (parseIsoTimestamp(value.requestedAt) === undefined) {
      addIssue(
        issues,
        'INVALID_EXECUTION_REQUEST',
        '$.metadata.requestedAt',
        'must be an ISO timestamp',
      );
    }
    validateScalarMetadata(
      value.values,
      '$.metadata.values',
      this.limits.maximumMetadataEntries,
      issues,
      'INVALID_EXECUTION_REQUEST',
    );
  }

  private validateCancellation(value: unknown, issues: ExecutionValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CANCELLATION', '$.cancellation', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['cancelled', 'reason', 'subscribe'],
      '$.cancellation',
      issues,
      'INVALID_CANCELLATION',
    );
    if (typeof value.cancelled !== 'boolean') {
      addIssue(issues, 'INVALID_CANCELLATION', '$.cancellation.cancelled', 'must be a boolean');
    }
    if (value.cancelled === true && !isNonEmptyString(value.reason)) {
      addIssue(
        issues,
        'INVALID_CANCELLATION',
        '$.cancellation.reason',
        'is required when cancellation is requested',
      );
    }
    if (value.cancelled === false && value.reason !== undefined) {
      addIssue(
        issues,
        'INVALID_CANCELLATION',
        '$.cancellation.reason',
        'must be absent when cancellation is not requested',
      );
    }
    if (typeof value.subscribe !== 'function') {
      addIssue(
        issues,
        'INVALID_CANCELLATION',
        '$.cancellation.subscribe',
        'must be a subscription function',
      );
    }
  }
}
