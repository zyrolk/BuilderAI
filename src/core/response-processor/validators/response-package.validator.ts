import { PROVIDER_DIAGNOSTIC_SEVERITIES } from '../../ai-provider';
import { ExecutionEngineValidationError, ExecutionResultValidator } from '../../execution-engine';
import type { ResponseProcessorConfiguration } from '../config';
import { DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION } from '../config';
import {
  ARTIFACT_MANIFEST_SCHEMA_VERSION,
  RESPONSE_ARTIFACT_TYPES,
  RESPONSE_PACKAGE_SCHEMA_VERSION,
  ResponseProcessorValidationError,
  type ResponsePackage,
  type ResponseProcessorValidationIssue,
} from '../types';
import { ResponseProcessorConfigurationValidator } from './configuration.validator';
import { GeneratedArtifactValidator, isSafeLogicalPath } from './generated-artifact.validator';
import {
  addIssue,
  CHECKSUM_ALGORITHM_PATTERN,
  CHECKSUM_VALUE_PATTERN,
  compareText,
  isNonNegativeSafeInteger,
  isRecord,
  validateExactKeys,
  validateMetadata,
} from './validation-helpers';

export class ResponsePackageValidator {
  private readonly executionValidator: ExecutionResultValidator = new ExecutionResultValidator();
  private readonly artifactValidator: GeneratedArtifactValidator;
  private readonly configurationValidator: ResponseProcessorConfigurationValidator =
    new ResponseProcessorConfigurationValidator();

  constructor(
    private readonly configuration: ResponseProcessorConfiguration = DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION,
  ) {
    this.configurationValidator.validate(configuration);
    this.artifactValidator = new GeneratedArtifactValidator(configuration);
  }

  validate(value: unknown): asserts value is ResponsePackage {
    const issues: ResponseProcessorValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new ResponseProcessorValidationError([
        { code: 'INVALID_RESPONSE_PACKAGE', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      [
        'schemaVersion',
        'executionResult',
        'generatedArtifacts',
        'manifest',
        'diagnostics',
        'warnings',
        'metadata',
      ],
      '$',
      issues,
      'INVALID_RESPONSE_PACKAGE',
    );
    if (value.schemaVersion !== RESPONSE_PACKAGE_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_RESPONSE_VERSION',
        '$.schemaVersion',
        `must equal ${RESPONSE_PACKAGE_SCHEMA_VERSION}`,
      );
    }
    this.validateExecutionResult(value.executionResult, issues);
    this.validateArtifacts(value.generatedArtifacts, issues);
    this.validateManifest(value.manifest, issues);
    validateDiagnostics(value.diagnostics, '$.diagnostics', issues);
    validateWarnings(value.warnings, '$.warnings', issues);
    validateMetadata(
      value.metadata,
      '$.metadata',
      issues,
      this.configuration.maximumMetadataEntries,
      this.configuration.maximumMetadataStringCharacters,
    );
    if (issues.length === 0 && isResponsePackageShape(value)) {
      this.validateCanonicalOrder(value, issues);
    }
    if (issues.length > 0) throw new ResponseProcessorValidationError(issues);
  }

  private validateExecutionResult(
    value: unknown,
    issues: ResponseProcessorValidationIssue[],
  ): void {
    try {
      this.executionValidator.validate(value);
      if (value.status !== 'COMPLETED') {
        addIssue(
          issues,
          'INVALID_RESPONSE_PACKAGE',
          '$.executionResult.status',
          "must equal 'COMPLETED'",
        );
      }
    } catch (error: unknown) {
      if (error instanceof ExecutionEngineValidationError) {
        for (const issue of error.issues) {
          addIssue(
            issues,
            'INVALID_RESPONSE_PACKAGE',
            `$.executionResult${issue.path.slice(1)}`,
            issue.message,
          );
        }
      } else {
        throw error;
      }
    }
  }

  private validateArtifacts(value: unknown, issues: ResponseProcessorValidationIssue[]): void {
    try {
      this.artifactValidator.validate(value);
    } catch (error: unknown) {
      if (error instanceof ResponseProcessorValidationError) {
        for (const issue of error.issues) {
          issues.push({ ...issue, path: `$.generatedArtifacts${issue.path.slice(1)}` });
        }
      } else {
        throw error;
      }
    }
  }

  private validateManifest(value: unknown, issues: ResponseProcessorValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', '$.manifest', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['schemaVersion', 'checksumAlgorithm', 'entries', 'totalSizeBytes'],
      '$.manifest',
      issues,
      'INVALID_RESPONSE_PACKAGE',
    );
    if (value.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_RESPONSE_VERSION',
        '$.manifest.schemaVersion',
        `must equal ${ARTIFACT_MANIFEST_SCHEMA_VERSION}`,
      );
    }
    if (
      typeof value.checksumAlgorithm !== 'string' ||
      !CHECKSUM_ALGORITHM_PATTERN.test(value.checksumAlgorithm)
    ) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        '$.manifest.checksumAlgorithm',
        'has an invalid identifier',
      );
    } else if (value.checksumAlgorithm !== this.configuration.checksumAlgorithm) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        '$.manifest.checksumAlgorithm',
        'must match configured checksum algorithm',
      );
    }
    if (!Array.isArray(value.entries)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', '$.manifest.entries', 'must be an array');
    } else {
      const paths = new Set<string>();
      value.entries.forEach((entry, index) => this.validateManifestEntry(entry, index, issues));
      value.entries.forEach((entry, index) => {
        if (!isRecord(entry) || !isSafeLogicalPath(entry.logicalPath)) return;
        const comparable = entry.logicalPath.toLowerCase();
        if (paths.has(comparable)) {
          addIssue(
            issues,
            'DUPLICATE_ARTIFACT_PATH',
            `$.manifest.entries[${index}].logicalPath`,
            'duplicates another manifest path',
          );
        }
        paths.add(comparable);
      });
    }
    if (!isNonNegativeSafeInteger(value.totalSizeBytes)) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        '$.manifest.totalSizeBytes',
        'must be a non-negative safe integer',
      );
    }
  }

  private validateManifestEntry(
    value: unknown,
    index: number,
    issues: ResponseProcessorValidationIssue[],
  ): void {
    const path = `$.manifest.entries[${index}]`;
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', path, 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['logicalPath', 'type', 'checksum', 'sizeBytes', 'metadata'],
      path,
      issues,
      'INVALID_RESPONSE_PACKAGE',
    );
    if (!isSafeLogicalPath(value.logicalPath)) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        `${path}.logicalPath`,
        'must be a normalized repository-relative POSIX path',
      );
    }
    if (!RESPONSE_ARTIFACT_TYPES.includes(value.type as never)) {
      addIssue(issues, 'UNSUPPORTED_ARTIFACT_TYPE', `${path}.type`, 'is unsupported');
    }
    if (!isRecord(value.checksum)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', `${path}.checksum`, 'must be an object');
    } else {
      validateExactKeys(
        value.checksum,
        ['algorithm', 'value'],
        `${path}.checksum`,
        issues,
        'INVALID_RESPONSE_PACKAGE',
      );
      if (value.checksum.algorithm !== this.configuration.checksumAlgorithm) {
        addIssue(
          issues,
          'INVALID_RESPONSE_PACKAGE',
          `${path}.checksum.algorithm`,
          'must match configured checksum algorithm',
        );
      }
      if (
        typeof value.checksum.value !== 'string' ||
        !CHECKSUM_VALUE_PATTERN.test(value.checksum.value)
      ) {
        addIssue(
          issues,
          'INVALID_RESPONSE_PACKAGE',
          `${path}.checksum.value`,
          'must be a lowercase hexadecimal checksum',
        );
      }
    }
    if (!isNonNegativeSafeInteger(value.sizeBytes)) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        `${path}.sizeBytes`,
        'must be a non-negative safe integer',
      );
    }
    validateMetadata(
      value.metadata,
      `${path}.metadata`,
      issues,
      this.configuration.maximumMetadataEntries,
      this.configuration.maximumMetadataStringCharacters,
      this.configuration.requiredArtifactMetadataKeys,
    );
  }

  private validateCanonicalOrder(
    value: ResponsePackage,
    issues: ResponseProcessorValidationIssue[],
  ): void {
    const artifactPaths = value.generatedArtifacts.map(({ logicalPath }) => logicalPath);
    if (!isSorted(artifactPaths)) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        '$.generatedArtifacts',
        'must use canonical logical-path order',
      );
    }
    const manifestPaths = value.manifest.entries.map(({ logicalPath }) => logicalPath);
    if (!isSorted(manifestPaths)) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        '$.manifest.entries',
        'must use canonical logical-path order',
      );
    }
    value.generatedArtifacts.forEach((artifact, index) => {
      if (!isSorted(Object.keys(artifact.metadata))) {
        addIssue(
          issues,
          'INVALID_RESPONSE_PACKAGE',
          `$.generatedArtifacts[${index}].metadata`,
          'keys must use canonical order',
        );
      }
    });
    value.manifest.entries.forEach((entry, index) => {
      if (!isSorted(Object.keys(entry.metadata))) {
        addIssue(
          issues,
          'INVALID_RESPONSE_PACKAGE',
          `$.manifest.entries[${index}].metadata`,
          'keys must use canonical order',
        );
      }
    });
    const diagnosticKeys = value.diagnostics.map(
      ({ code, severity, path, message }) => `${code}\0${severity}\0${path ?? ''}\0${message}`,
    );
    if (!isSorted(diagnosticKeys)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', '$.diagnostics', 'must use canonical order');
    }
    const warningKeys = value.warnings.map(({ code, message }) => `${code}\0${message}`);
    if (!isSorted(warningKeys)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', '$.warnings', 'must use canonical order');
    }
    if (!isSorted(Object.keys(value.metadata))) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', '$.metadata', 'keys must use canonical order');
    }
  }
}

function validateDiagnostics(
  value: unknown,
  path: string,
  issues: ResponseProcessorValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, 'INVALID_RESPONSE_PACKAGE', path, 'must be an array');
    return;
  }
  value.forEach((diagnostic, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(diagnostic)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', itemPath, 'must be an object');
      return;
    }
    validateExactKeys(
      diagnostic,
      ['code', 'severity', 'message', 'path'],
      itemPath,
      issues,
      'INVALID_RESPONSE_PACKAGE',
    );
    if (typeof diagnostic.code !== 'string' || diagnostic.code.length === 0) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', `${itemPath}.code`, 'must be non-empty');
    }
    if (!PROVIDER_DIAGNOSTIC_SEVERITIES.includes(diagnostic.severity as never)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', `${itemPath}.severity`, 'is unsupported');
    }
    if (typeof diagnostic.message !== 'string' || diagnostic.message.length === 0) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', `${itemPath}.message`, 'must be non-empty');
    }
    if (
      diagnostic.path !== undefined &&
      (typeof diagnostic.path !== 'string' || diagnostic.path.length === 0)
    ) {
      addIssue(
        issues,
        'INVALID_RESPONSE_PACKAGE',
        `${itemPath}.path`,
        'must be non-empty when present',
      );
    }
  });
}

function validateWarnings(
  value: unknown,
  path: string,
  issues: ResponseProcessorValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, 'INVALID_RESPONSE_PACKAGE', path, 'must be an array');
    return;
  }
  value.forEach((warning, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(warning)) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', itemPath, 'must be an object');
      return;
    }
    validateExactKeys(warning, ['code', 'message'], itemPath, issues, 'INVALID_RESPONSE_PACKAGE');
    if (typeof warning.code !== 'string' || warning.code.length === 0) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', `${itemPath}.code`, 'must be non-empty');
    }
    if (typeof warning.message !== 'string' || warning.message.length === 0) {
      addIssue(issues, 'INVALID_RESPONSE_PACKAGE', `${itemPath}.message`, 'must be non-empty');
    }
  });
}

function isResponsePackageShape(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ResponsePackage {
  return (
    Array.isArray(value.generatedArtifacts) &&
    isRecord(value.manifest) &&
    Array.isArray(value.manifest.entries) &&
    Array.isArray(value.diagnostics) &&
    Array.isArray(value.warnings) &&
    isRecord(value.metadata)
  );
}

function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || compareText(values[index - 1] ?? '', value) <= 0,
  );
}
