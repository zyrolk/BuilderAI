import {
  DEFAULT_EXECUTION_ENGINE_CONFIGURATION,
  type ExecutionEngineConfiguration,
} from '../config';
import {
  EXECUTION_ARTIFACT_KINDS,
  EXECUTION_DIAGNOSTIC_SEVERITIES,
  EXECUTION_RESULT_SCHEMA_VERSION,
  ExecutionEngineValidationError,
  type ExecutionResult,
  type ExecutionValidationIssue,
} from '../types';
import { ExecutionEngineConfigurationValidator } from './configuration.validator';
import {
  addIssue,
  duplicates,
  EXECUTION_ERROR_CODE_PATTERN,
  EXECUTION_IDENTIFIER_PATTERN,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
  parseIsoTimestamp,
  validateExactKeys,
  validateScalarMetadata,
} from './validation-helpers';

const TERMINAL_STATES = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const;

export class ExecutionResultValidator {
  private readonly configurationValidator: ExecutionEngineConfigurationValidator =
    new ExecutionEngineConfigurationValidator();

  constructor(
    private readonly limits: ExecutionEngineConfiguration = DEFAULT_EXECUTION_ENGINE_CONFIGURATION,
  ) {
    this.configurationValidator.validate(limits);
  }

  validate(value: unknown): asserts value is ExecutionResult {
    const issues: ExecutionValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new ExecutionEngineValidationError([
        { code: 'INVALID_EXECUTION_RESULT', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      [
        'schemaVersion',
        'executionId',
        'status',
        'diagnostics',
        'timing',
        'usage',
        'artifacts',
        'errors',
        'metadata',
      ],
      '$',
      issues,
      'INVALID_EXECUTION_RESULT',
    );
    if (value.schemaVersion !== EXECUTION_RESULT_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_EXECUTION_VERSION',
        '$.schemaVersion',
        `must equal ${EXECUTION_RESULT_SCHEMA_VERSION}`,
      );
    }
    if (
      !isNonEmptyString(value.executionId) ||
      !EXECUTION_IDENTIFIER_PATTERN.test(value.executionId)
    ) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.executionId', 'has an invalid identifier');
    }
    if (!TERMINAL_STATES.includes(value.status as never)) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.status', 'must be a terminal state');
    }
    this.validateDiagnostics(value.diagnostics, issues);
    this.validateTiming(value.timing, issues);
    this.validateUsage(value.usage, issues);
    this.validateArtifacts(value.artifacts, issues);
    this.validateErrors(value.errors, value.status, issues);
    validateScalarMetadata(
      value.metadata,
      '$.metadata',
      this.limits.maximumMetadataEntries,
      issues,
      'INVALID_EXECUTION_RESULT',
    );
    if (issues.length > 0) throw new ExecutionEngineValidationError(issues);
  }

  private validateDiagnostics(value: unknown, issues: ExecutionValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.diagnostics', 'must be an array');
      return;
    }
    value.forEach((diagnostic, index) => {
      const path = `$.diagnostics[${index}]`;
      if (!isRecord(diagnostic)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', path, 'must be an object');
        return;
      }
      validateExactKeys(
        diagnostic,
        ['code', 'severity', 'message'],
        path,
        issues,
        'INVALID_EXECUTION_RESULT',
      );
      if (
        typeof diagnostic.code !== 'string' ||
        !EXECUTION_ERROR_CODE_PATTERN.test(diagnostic.code)
      ) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.code`, 'must be an uppercase code');
      }
      if (!EXECUTION_DIAGNOSTIC_SEVERITIES.includes(diagnostic.severity as never)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.severity`, 'is unsupported');
      }
      if (!isNonEmptyString(diagnostic.message)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.message`, 'must be non-empty');
      }
    });
  }

  private validateTiming(value: unknown, issues: ExecutionValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.timing', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['createdAt', 'finishedAt', 'durationMs'],
      '$.timing',
      issues,
      'INVALID_EXECUTION_RESULT',
    );
    const createdAt = parseIsoTimestamp(value.createdAt);
    const finishedAt = parseIsoTimestamp(value.finishedAt);
    if (createdAt === undefined) {
      addIssue(
        issues,
        'INVALID_EXECUTION_RESULT',
        '$.timing.createdAt',
        'must be an ISO timestamp',
      );
    }
    if (finishedAt === undefined) {
      addIssue(
        issues,
        'INVALID_EXECUTION_RESULT',
        '$.timing.finishedAt',
        'must be an ISO timestamp',
      );
    }
    if (!isNonNegativeSafeInteger(value.durationMs)) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.timing.durationMs', 'must be non-negative');
    } else if (
      createdAt !== undefined &&
      finishedAt !== undefined &&
      (finishedAt < createdAt || value.durationMs !== finishedAt - createdAt)
    ) {
      addIssue(
        issues,
        'INVALID_EXECUTION_RESULT',
        '$.timing',
        'must contain consistent monotonic timing',
      );
    }
  }

  private validateUsage(value: unknown, issues: ExecutionValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.usage', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['promptCharacters', 'outputCharacters', 'estimated'],
      '$.usage',
      issues,
      'INVALID_EXECUTION_RESULT',
    );
    if (!isNonNegativeSafeInteger(value.promptCharacters)) {
      addIssue(
        issues,
        'INVALID_EXECUTION_RESULT',
        '$.usage.promptCharacters',
        'must be non-negative',
      );
    }
    if (value.outputCharacters !== undefined && !isNonNegativeSafeInteger(value.outputCharacters)) {
      addIssue(
        issues,
        'INVALID_EXECUTION_RESULT',
        '$.usage.outputCharacters',
        'must be non-negative when present',
      );
    }
    if (typeof value.estimated !== 'boolean') {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.usage.estimated', 'must be a boolean');
    }
  }

  private validateArtifacts(value: unknown, issues: ExecutionValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.artifacts', 'must be an array');
      return;
    }
    const identifiers: string[] = [];
    value.forEach((artifact, index) => {
      const path = `$.artifacts[${index}]`;
      if (!isRecord(artifact)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', path, 'must be an object');
        return;
      }
      validateExactKeys(
        artifact,
        ['id', 'name', 'kind', 'state'],
        path,
        issues,
        'INVALID_EXECUTION_RESULT',
      );
      if (typeof artifact.id !== 'string' || !EXECUTION_IDENTIFIER_PATTERN.test(artifact.id)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.id`, 'has an invalid identifier');
      } else {
        identifiers.push(artifact.id);
      }
      if (!isNonEmptyString(artifact.name)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.name`, 'must be non-empty');
      }
      if (!EXECUTION_ARTIFACT_KINDS.includes(artifact.kind as never)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.kind`, 'is unsupported');
      }
      if (artifact.state !== 'PLACEHOLDER') {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.state`, "must equal 'PLACEHOLDER'");
      }
    });
    for (const duplicate of duplicates(identifiers)) {
      addIssue(
        issues,
        'DUPLICATE_EXECUTION_INFORMATION',
        '$.artifacts',
        `contains duplicate '${duplicate}'`,
      );
    }
  }

  private validateErrors(
    value: unknown,
    status: unknown,
    issues: ExecutionValidationIssue[],
  ): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_EXECUTION_RESULT', '$.errors', 'must be an array');
      return;
    }
    const codes: string[] = [];
    value.forEach((error, index) => {
      const path = `$.errors[${index}]`;
      if (!isRecord(error)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', path, 'must be an object');
        return;
      }
      validateExactKeys(
        error,
        ['code', 'message', 'retryable'],
        path,
        issues,
        'INVALID_EXECUTION_RESULT',
      );
      if (typeof error.code !== 'string' || !EXECUTION_ERROR_CODE_PATTERN.test(error.code)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.code`, 'must be an uppercase code');
      } else {
        codes.push(error.code);
      }
      if (!isNonEmptyString(error.message)) {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.message`, 'must be non-empty');
      }
      if (typeof error.retryable !== 'boolean') {
        addIssue(issues, 'INVALID_EXECUTION_RESULT', `${path}.retryable`, 'must be a boolean');
      }
    });
    for (const duplicate of duplicates(codes)) {
      addIssue(
        issues,
        'DUPLICATE_EXECUTION_INFORMATION',
        '$.errors',
        `contains duplicate '${duplicate}'`,
      );
    }
    if (status === 'COMPLETED' && value.length > 0) {
      addIssue(
        issues,
        'INVALID_EXECUTION_RESULT',
        '$.errors',
        'must be empty for completed results',
      );
    }
    if ((status === 'FAILED' || status === 'TIMED_OUT') && value.length === 0) {
      addIssue(
        issues,
        'INVALID_EXECUTION_RESULT',
        '$.errors',
        `must describe a ${String(status).toLowerCase()} result`,
      );
    }
  }
}
