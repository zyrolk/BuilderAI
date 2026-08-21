import type { VerificationConfiguration } from '../config';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../config';
import {
  VERIFICATION_STAGE_STATUSES,
  VERIFICATION_STAGE_FAILURE_OUTCOMES,
  VERIFICATION_STAGE_SUCCESS_OUTCOMES,
  VerificationValidationError,
  type VerificationStagePortResult,
  type VerificationValidationIssue,
} from '../types';
import {
  addIssue,
  isRecord,
  validateMessages,
  validateMetadata,
  validateOptionalDiagnostic,
  validateRequiredKeys,
} from './validation-helpers';
import { VerificationConfigurationValidator } from './configuration.validator';

export class VerificationStagePortResultValidator {
  private readonly configurationValidator: VerificationConfigurationValidator =
    new VerificationConfigurationValidator();

  constructor(
    private readonly configuration: VerificationConfiguration = DEFAULT_VERIFICATION_CONFIGURATION,
  ) {
    this.configurationValidator.validate(configuration);
  }

  validate(value: unknown): asserts value is VerificationStagePortResult {
    const issues: VerificationValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new VerificationValidationError([
        { code: 'INVALID_PORT_RESULT', path: '$', message: 'must be an object' },
      ]);
    }
    validateRequiredKeys(
      value,
      ['status', 'warnings', 'errors', 'metadata'],
      '$',
      issues,
      'INVALID_PORT_RESULT',
    );
    for (const key of Object.keys(value)) {
      if (!['status', 'warnings', 'errors', 'metadata', 'diagnostic'].includes(key)) {
        addIssue(issues, 'INVALID_PORT_RESULT', `$.${key}`, 'is not allowed');
      }
    }
    if (!VERIFICATION_STAGE_STATUSES.some((status) => status === value.status)) {
      addIssue(issues, 'INVALID_PORT_RESULT', '$.status', 'is unsupported');
    }
    validateMessages(
      value.warnings,
      '$.warnings',
      issues,
      'INVALID_PORT_RESULT',
      this.configuration.maximumFindingsPerStage,
      this.configuration.maximumFindingMessageCharacters,
      false,
    );
    validateMessages(
      value.errors,
      '$.errors',
      issues,
      'INVALID_PORT_RESULT',
      this.configuration.maximumFindingsPerStage,
      this.configuration.maximumFindingMessageCharacters,
      false,
    );
    validateMetadata(
      value.metadata,
      '$.metadata',
      issues,
      'INVALID_PORT_RESULT',
      this.configuration.maximumStageMetadataEntries,
      this.configuration.maximumStageMetadataStringCharacters,
      false,
    );
    validateOptionalDiagnostic(value.diagnostic, '$.diagnostic', issues, 'INVALID_PORT_RESULT', {
      maximumStdoutCharacters: this.configuration.maximumDiagnosticStdoutCharacters,
      maximumStderrCharacters: this.configuration.maximumDiagnosticStderrCharacters,
      maximumCombinedCharacters: this.configuration.maximumDiagnosticCombinedCharacters,
    });
    if (Array.isArray(value.errors)) {
      if (
        (VERIFICATION_STAGE_SUCCESS_OUTCOMES as readonly string[]).includes(String(value.status)) &&
        value.errors.length > 0
      ) {
        addIssue(
          issues,
          'INVALID_PORT_RESULT',
          '$.status',
          `${String(value.status)} cannot contain errors`,
        );
      }
      if (
        (VERIFICATION_STAGE_FAILURE_OUTCOMES as readonly string[]).includes(String(value.status)) &&
        value.errors.length === 0
      ) {
        addIssue(
          issues,
          'INVALID_PORT_RESULT',
          '$.status',
          `${String(value.status)} requires at least one error`,
        );
      }
      if (value.status === 'FAILED' && value.errors.length === 0) {
        addIssue(issues, 'INVALID_PORT_RESULT', '$.status', 'FAILED requires at least one error');
      }
    }
    if (issues.length > 0) throw new VerificationValidationError(issues);
  }
}
