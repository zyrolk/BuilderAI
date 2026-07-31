import type { VerificationConfiguration } from '../config';
import {
  VERIFICATION_STAGES,
  VerificationValidationError,
  type VerificationValidationIssue,
} from '../types';
import { addIssue, isPositiveSafeInteger, isRecord, validateExactKeys } from './validation-helpers';

export class VerificationConfigurationValidator {
  validate(value: unknown): asserts value is VerificationConfiguration {
    const issues: VerificationValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new VerificationValidationError([
        { code: 'INVALID_CONFIGURATION', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      [
        'pipeline',
        'maximumFindingsPerStage',
        'maximumFindingMessageCharacters',
        'maximumStageMetadataEntries',
        'maximumStageMetadataStringCharacters',
      ],
      '$',
      issues,
      'INVALID_CONFIGURATION',
    );
    if (
      !Array.isArray(value.pipeline) ||
      value.pipeline.length !== VERIFICATION_STAGES.length ||
      !value.pipeline.every((stage, index) => stage === VERIFICATION_STAGES[index])
    ) {
      addIssue(
        issues,
        'INVALID_STAGE_ORDER',
        '$.pipeline',
        `must equal ${VERIFICATION_STAGES.join(', ')}`,
      );
    }
    for (const key of [
      'maximumFindingsPerStage',
      'maximumFindingMessageCharacters',
      'maximumStageMetadataEntries',
      'maximumStageMetadataStringCharacters',
    ] as const) {
      if (!isPositiveSafeInteger(value[key])) {
        addIssue(issues, 'INVALID_CONFIGURATION', `$.${key}`, 'must be a positive safe integer');
      }
    }
    if (issues.length > 0) throw new VerificationValidationError(issues);
  }
}
