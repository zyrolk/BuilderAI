import type { ResponseProcessorConfiguration } from '../config';
import { ResponseProcessorValidationError, type ResponseProcessorValidationIssue } from '../types';
import {
  addIssue,
  CHECKSUM_ALGORITHM_PATTERN,
  isPositiveSafeInteger,
  isRecord,
  METADATA_KEY_PATTERN,
  validateExactKeys,
} from './validation-helpers';

export class ResponseProcessorConfigurationValidator {
  validate(value: unknown): asserts value is ResponseProcessorConfiguration {
    const issues: ResponseProcessorValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CONFIGURATION', '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        [
          'maximumArtifacts',
          'maximumArtifactBytes',
          'maximumTotalBytes',
          'maximumMetadataEntries',
          'maximumMetadataStringCharacters',
          'requiredArtifactMetadataKeys',
          'checksumAlgorithm',
        ],
        '$',
        issues,
        'INVALID_CONFIGURATION',
      );
      for (const field of [
        'maximumArtifacts',
        'maximumArtifactBytes',
        'maximumTotalBytes',
        'maximumMetadataEntries',
        'maximumMetadataStringCharacters',
      ] as const) {
        if (!isPositiveSafeInteger(value[field])) {
          addIssue(issues, 'INVALID_CONFIGURATION', `$.${field}`, 'must be positive');
        }
      }
      if (
        isPositiveSafeInteger(value.maximumArtifactBytes) &&
        isPositiveSafeInteger(value.maximumTotalBytes) &&
        value.maximumArtifactBytes > value.maximumTotalBytes
      ) {
        addIssue(
          issues,
          'INVALID_CONFIGURATION',
          '$.maximumArtifactBytes',
          'must not exceed maximumTotalBytes',
        );
      }
      if (!Array.isArray(value.requiredArtifactMetadataKeys)) {
        addIssue(
          issues,
          'INVALID_CONFIGURATION',
          '$.requiredArtifactMetadataKeys',
          'must be an array',
        );
      } else {
        const keys = value.requiredArtifactMetadataKeys.filter(
          (key): key is string => typeof key === 'string',
        );
        if (keys.length !== value.requiredArtifactMetadataKeys.length) {
          addIssue(
            issues,
            'INVALID_CONFIGURATION',
            '$.requiredArtifactMetadataKeys',
            'must contain only strings',
          );
        }
        for (const key of keys) {
          if (!METADATA_KEY_PATTERN.test(key)) {
            addIssue(
              issues,
              'INVALID_CONFIGURATION',
              '$.requiredArtifactMetadataKeys',
              `contains invalid key '${key}'`,
            );
          }
        }
        if (new Set(keys).size !== keys.length) {
          addIssue(
            issues,
            'INVALID_CONFIGURATION',
            '$.requiredArtifactMetadataKeys',
            'must not contain duplicates',
          );
        }
      }
      if (
        typeof value.checksumAlgorithm !== 'string' ||
        !CHECKSUM_ALGORITHM_PATTERN.test(value.checksumAlgorithm)
      ) {
        addIssue(
          issues,
          'INVALID_CONFIGURATION',
          '$.checksumAlgorithm',
          'must be a lowercase kebab-case identifier',
        );
      }
    }
    if (issues.length > 0) throw new ResponseProcessorValidationError(issues);
  }
}
