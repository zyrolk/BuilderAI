import { ProviderContractViolationError, ProviderResponseValidator } from '../../ai-provider';
import { ExecutionEngineValidationError, ExecutionResultValidator } from '../../execution-engine';
import type { ResponseProcessorConfiguration } from '../config';
import { DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION } from '../config';
import {
  ResponseProcessorValidationError,
  type ResponseProcessingInput,
  type ResponseProcessorValidationIssue,
} from '../types';
import { ResponseProcessorConfigurationValidator } from './configuration.validator';
import { addIssue, isRecord, validateExactKeys, validateMetadata } from './validation-helpers';

export class ResponseProcessingInputValidator {
  private readonly providerValidator: ProviderResponseValidator = new ProviderResponseValidator();
  private readonly executionValidator: ExecutionResultValidator = new ExecutionResultValidator();
  private readonly configurationValidator: ResponseProcessorConfigurationValidator =
    new ResponseProcessorConfigurationValidator();

  constructor(
    private readonly configuration: ResponseProcessorConfiguration = DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION,
  ) {
    this.configurationValidator.validate(configuration);
  }

  validate(value: unknown): asserts value is ResponseProcessingInput {
    const issues: ResponseProcessorValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new ResponseProcessorValidationError([
        { code: 'INVALID_RESPONSE_INPUT', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      ['providerResponse', 'executionResult', 'metadata'],
      '$',
      issues,
      'INVALID_RESPONSE_INPUT',
    );
    const providerValid = this.validateProviderResponse(value.providerResponse, issues);
    const executionValid = this.validateExecutionResult(value.executionResult, issues);
    if (value.metadata !== undefined) {
      validateMetadata(
        value.metadata,
        '$.metadata',
        issues,
        this.configuration.maximumMetadataEntries,
        this.configuration.maximumMetadataStringCharacters,
      );
    }
    if (providerValid && executionValid && isCorrelatableInput(value)) {
      this.validateCorrelation(value, issues);
    }
    if (issues.length > 0) throw new ResponseProcessorValidationError(issues);
  }

  private validateProviderResponse(
    value: unknown,
    issues: ResponseProcessorValidationIssue[],
  ): boolean {
    try {
      this.providerValidator.validate(value);
    } catch (error: unknown) {
      if (error instanceof ProviderContractViolationError) {
        for (const issue of error.issues) {
          addIssue(
            issues,
            'INVALID_RESPONSE_INPUT',
            `$.providerResponse${issue.path.slice(1)}`,
            issue.message,
          );
        }
        return false;
      } else {
        throw error;
      }
    }
    return true;
  }

  private validateExecutionResult(
    value: unknown,
    issues: ResponseProcessorValidationIssue[],
  ): boolean {
    try {
      this.executionValidator.validate(value);
    } catch (error: unknown) {
      if (error instanceof ExecutionEngineValidationError) {
        for (const issue of error.issues) {
          addIssue(
            issues,
            'INVALID_RESPONSE_INPUT',
            `$.executionResult${issue.path.slice(1)}`,
            issue.message,
          );
        }
        return false;
      } else {
        throw error;
      }
    }
    return true;
  }

  private validateCorrelation(
    value: ResponseProcessingInput,
    issues: ResponseProcessorValidationIssue[],
  ): void {
    const { providerResponse, executionResult } = value;
    if (providerResponse.status !== 'COMPLETED') {
      addIssue(
        issues,
        'INVALID_RESPONSE_INPUT',
        '$.providerResponse.status',
        "must equal 'COMPLETED'",
      );
    }
    if (executionResult.status !== 'COMPLETED') {
      addIssue(
        issues,
        'INVALID_RESPONSE_INPUT',
        '$.executionResult.status',
        "must equal 'COMPLETED'",
      );
    }
    if (providerResponse.requestId !== executionResult.executionId) {
      addIssue(
        issues,
        'INTEGRITY_MISMATCH',
        '$.executionResult.executionId',
        'must match the provider response request identity',
      );
    }
    if (providerResponse.usage.promptCharacters !== executionResult.usage.promptCharacters) {
      addIssue(
        issues,
        'INTEGRITY_MISMATCH',
        '$.executionResult.usage.promptCharacters',
        'must match provider response usage',
      );
    }
    if (providerResponse.usage.outputCharacters !== executionResult.usage.outputCharacters) {
      addIssue(
        issues,
        'INTEGRITY_MISMATCH',
        '$.executionResult.usage.outputCharacters',
        'must match provider response usage',
      );
    }
    const providerArtifacts = providerResponse.artifacts
      .map(({ id, kind, name }) => `${id}\0${kind}\0${name}`)
      .sort();
    const executionArtifacts = executionResult.artifacts
      .map(({ id, kind, name }) => `${id}\0${kind}\0${name}`)
      .sort();
    if (JSON.stringify(providerArtifacts) !== JSON.stringify(executionArtifacts)) {
      addIssue(
        issues,
        'INTEGRITY_MISMATCH',
        '$.executionResult.artifacts',
        'must match provider response artifact placeholders',
      );
    }
    const structured = providerResponse.artifacts.filter(
      (artifact) => artifact.kind === 'STRUCTURED_DATA',
    );
    if (structured.length !== 1) {
      addIssue(
        issues,
        'INVALID_RESPONSE_INPUT',
        '$.providerResponse.artifacts',
        'must contain exactly one structured artifact',
      );
    } else {
      const first = structured[0];
      if (
        first?.kind !== 'STRUCTURED_DATA' ||
        !isRecord(first.data) ||
        !Array.isArray(first.data.artifacts)
      ) {
        addIssue(
          issues,
          'INVALID_RESPONSE_INPUT',
          '$.providerResponse.artifacts.structured.data.artifacts',
          'must be an array',
        );
      }
    }
    validateMetadataCompatibility(
      executionResult.metadata,
      providerResponse.metadata,
      '$.providerResponse.metadata',
      issues,
    );
    if (value.metadata !== undefined) {
      validateMetadataCompatibility(
        { ...executionResult.metadata, ...providerResponse.metadata },
        value.metadata,
        '$.metadata',
        issues,
      );
    }
  }
}

function isCorrelatableInput(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ResponseProcessingInput {
  return isRecord(value.providerResponse) && isRecord(value.executionResult);
}

function validateMetadataCompatibility(
  existing: Readonly<Record<string, unknown>>,
  candidate: Readonly<Record<string, unknown>>,
  path: string,
  issues: ResponseProcessorValidationIssue[],
): void {
  for (const [key, item] of Object.entries(candidate)) {
    if (key in existing && existing[key] !== item) {
      addIssue(
        issues,
        'INTEGRITY_MISMATCH',
        `${path}.${key}`,
        'conflicts with existing response metadata',
      );
    }
  }
}
