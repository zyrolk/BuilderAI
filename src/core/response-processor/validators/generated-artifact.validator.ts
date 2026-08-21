import type { ResponseProcessorConfiguration } from '../config';
import { DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION } from '../config';
import {
  RESPONSE_ARTIFACT_TYPES,
  ResponseProcessorValidationError,
  type GeneratedArtifact,
  type ResponseProcessorValidationIssue,
} from '../types';
import { ResponseProcessorConfigurationValidator } from './configuration.validator';
import {
  addIssue,
  isRecord,
  utf8Size,
  validateExactKeys,
  validateMetadata,
} from './validation-helpers';

export class GeneratedArtifactValidator {
  private readonly configurationValidator: ResponseProcessorConfigurationValidator =
    new ResponseProcessorConfigurationValidator();

  constructor(
    private readonly configuration: ResponseProcessorConfiguration = DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION,
  ) {
    this.configurationValidator.validate(configuration);
  }

  validate(value: unknown): asserts value is readonly GeneratedArtifact[] {
    const issues: ResponseProcessorValidationIssue[] = [];
    if (!Array.isArray(value)) {
      throw new ResponseProcessorValidationError([
        { code: 'INVALID_ARTIFACT', path: '$', message: 'must be an array' },
      ]);
    }
    if (value.length > this.configuration.maximumArtifacts) {
      addIssue(
        issues,
        'RESPONSE_SIZE_EXCEEDED',
        '$',
        `must contain at most ${this.configuration.maximumArtifacts} artifacts`,
      );
    }
    let totalSizeBytes = 0;
    const paths = new Map<string, string>();
    value.forEach((artifact, index) => {
      const path = `$[${index}]`;
      if (!isRecord(artifact)) {
        addIssue(issues, 'INVALID_ARTIFACT', path, 'must be an object');
        return;
      }
      validateExactKeys(
        artifact,
        ['logicalPath', 'type', 'content', 'metadata'],
        path,
        issues,
        'INVALID_ARTIFACT',
      );
      if (!isSafeLogicalPath(artifact.logicalPath)) {
        addIssue(
          issues,
          'INVALID_ARTIFACT',
          `${path}.logicalPath`,
          'must be a normalized repository-relative POSIX path',
        );
      } else {
        const comparable = artifact.logicalPath.toLowerCase();
        const existing = paths.get(comparable);
        if (existing !== undefined) {
          addIssue(
            issues,
            'DUPLICATE_ARTIFACT_PATH',
            `${path}.logicalPath`,
            `duplicates '${existing}'`,
          );
        } else {
          paths.set(comparable, artifact.logicalPath);
        }
      }
      if (!RESPONSE_ARTIFACT_TYPES.includes(artifact.type as never)) {
        addIssue(issues, 'UNSUPPORTED_ARTIFACT_TYPE', `${path}.type`, 'is unsupported');
      }
      if (typeof artifact.content !== 'string') {
        addIssue(issues, 'INVALID_ARTIFACT', `${path}.content`, 'must be a string');
      } else {
        const size = utf8Size(artifact.content);
        totalSizeBytes += size;
        if (size > this.configuration.maximumArtifactBytes) {
          addIssue(
            issues,
            'RESPONSE_SIZE_EXCEEDED',
            `${path}.content`,
            `must contain at most ${this.configuration.maximumArtifactBytes} UTF-8 bytes`,
          );
        }
      }
      validateMetadata(
        artifact.metadata,
        `${path}.metadata`,
        issues,
        this.configuration.maximumMetadataEntries,
        this.configuration.maximumMetadataStringCharacters,
        this.configuration.requiredArtifactMetadataKeys,
      );
    });
    if (totalSizeBytes > this.configuration.maximumTotalBytes) {
      addIssue(
        issues,
        'RESPONSE_SIZE_EXCEEDED',
        '$',
        `total artifact content must contain at most ${this.configuration.maximumTotalBytes} UTF-8 bytes`,
      );
    }
    if (issues.length > 0) throw new ResponseProcessorValidationError(issues);
  }
}

const SAFE_PATH_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu;

export function isSafeLogicalPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return false;
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/.test(value)) return false;
  if (value.includes('\\') || value.includes('//')) return false;
  return value
    .split('/')
    .every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..' &&
        segment.trim().length > 0 &&
        !segment.endsWith('.') &&
        !segment.endsWith(' ') &&
        !segment.includes(':') &&
        !SAFE_PATH_DEVICE_NAME_PATTERN.test(segment),
    );
}
