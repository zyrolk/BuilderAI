import type { VerificationConfiguration } from '../config';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../config';
import {
  VERIFICATION_STAGE_STATUSES,
  VerificationValidationError,
  type VerificationStagePortResult,
  type VerificationValidationIssue,
} from '../types';
import {
  addIssue,
  isRecord,
  validateExactKeys,
  validateMessages,
  validateMetadata,
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
    validateExactKeys(
      value,
      ['status', 'warnings', 'errors', 'metadata'],
      '$',
      issues,
      'INVALID_PORT_RESULT',
    );
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
    if (Array.isArray(value.errors)) {
      if (value.status === 'PASSED' && value.errors.length > 0) {
        addIssue(issues, 'INVALID_PORT_RESULT', '$.status', 'PASSED cannot contain errors');
      }
      if (value.status === 'FAILED' && value.errors.length === 0) {
        addIssue(issues, 'INVALID_PORT_RESULT', '$.status', 'FAILED requires at least one error');
      }
    }
    if (issues.length > 0) throw new VerificationValidationError(issues);
  }
}
