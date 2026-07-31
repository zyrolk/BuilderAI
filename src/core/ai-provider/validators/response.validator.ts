import {
  AI_PROVIDER_CONTRACT_VERSION,
  PROVIDER_ARTIFACT_KINDS,
  PROVIDER_DIAGNOSTIC_SEVERITIES,
  PROVIDER_RESPONSE_STATUSES,
  ProviderContractViolationError,
  type AIProviderResponse,
  type ProviderValidationIssue,
} from '../types';
import {
  addIssue,
  duplicateValues,
  IDENTIFIER_PATTERN,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
  validateExactKeys,
  validateMetadata,
} from './validation-helpers';

export class ProviderResponseValidator {
  validate(value: unknown): asserts value is AIProviderResponse {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        [
          'contractVersion',
          'requestId',
          'status',
          'artifacts',
          'diagnostics',
          'warnings',
          'statistics',
          'usage',
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
      if (!PROVIDER_RESPONSE_STATUSES.includes(value.status as never)) {
        addIssue(issues, '$.status', 'is unsupported');
      }
      this.validateArtifacts(value.artifacts, issues);
      this.validateDiagnostics(value.diagnostics, value.status, issues);
      this.validateWarnings(value.warnings, issues);
      this.validateStatistics(value.statistics, issues);
      this.validateUsage(value.usage, value.artifacts, issues);
      validateMetadata(value.metadata, '$.metadata', issues);
    }
    if (issues.length > 0) throw new ProviderContractViolationError('RESPONSE', issues);
  }

  private validateArtifacts(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, '$.artifacts', 'must be an array');
      return;
    }
    const ids: string[] = [];
    value.forEach((artifact, index) => {
      const path = `$.artifacts[${index}]`;
      if (!isRecord(artifact)) {
        addIssue(issues, path, 'must be an object');
        return;
      }
      const commonKeys = ['id', 'name', 'kind'];
      if (isNonEmptyString(artifact.id)) ids.push(artifact.id);
      else addIssue(issues, `${path}.id`, 'is required');
      if (!isNonEmptyString(artifact.name)) addIssue(issues, `${path}.name`, 'is required');
      if (!PROVIDER_ARTIFACT_KINDS.includes(artifact.kind as never)) {
        addIssue(issues, `${path}.kind`, 'is unsupported');
        return;
      }
      if (artifact.kind === 'TEXT' && typeof artifact.content !== 'string') {
        addIssue(issues, `${path}.content`, 'must be a string');
      }
      if (artifact.kind === 'TEXT') {
        validateExactKeys(artifact, [...commonKeys, 'content'], path, issues);
      }
      if (artifact.kind === 'STRUCTURED_DATA' && !isJsonValue(artifact.data)) {
        addIssue(issues, `${path}.data`, 'must be valid JSON data');
      }
      if (artifact.kind === 'STRUCTURED_DATA') {
        validateExactKeys(artifact, [...commonKeys, 'data'], path, issues);
      }
      if (artifact.kind === 'FILE') {
        validateExactKeys(artifact, [...commonKeys, 'path', 'mediaType', 'content'], path, issues);
        if (!isNonEmptyString(artifact.path)) addIssue(issues, `${path}.path`, 'is required');
        else if (!isSafeRelativePath(artifact.path)) {
          addIssue(issues, `${path}.path`, 'must be a normalized relative path');
        }
        if (!isNonEmptyString(artifact.mediaType))
          addIssue(issues, `${path}.mediaType`, 'is required');
        if (typeof artifact.content !== 'string')
          addIssue(issues, `${path}.content`, 'must be a string');
      }
      if (artifact.kind === 'IMAGE') {
        validateExactKeys(artifact, [...commonKeys, 'mediaType', 'data'], path, issues);
        if (!isNonEmptyString(artifact.mediaType))
          addIssue(issues, `${path}.mediaType`, 'is required');
        if (!isNonEmptyString(artifact.data)) addIssue(issues, `${path}.data`, 'is required');
      }
    });
    for (const duplicate of duplicateValues(ids)) {
      addIssue(issues, '$.artifacts', `contains duplicate id '${duplicate}'`);
    }
  }

  private validateDiagnostics(
    value: unknown,
    status: unknown,
    issues: ProviderValidationIssue[],
  ): void {
    if (!Array.isArray(value)) {
      addIssue(issues, '$.diagnostics', 'must be an array');
      return;
    }
    let hasError = false;
    value.forEach((diagnostic, index) => {
      const path = `$.diagnostics[${index}]`;
      if (!isRecord(diagnostic)) {
        addIssue(issues, path, 'must be an object');
        return;
      }
      validateExactKeys(diagnostic, ['code', 'severity', 'message', 'path'], path, issues);
      if (!isNonEmptyString(diagnostic.code)) addIssue(issues, `${path}.code`, 'is required');
      if (!PROVIDER_DIAGNOSTIC_SEVERITIES.includes(diagnostic.severity as never)) {
        addIssue(issues, `${path}.severity`, 'is unsupported');
      }
      if (diagnostic.severity === 'ERROR') hasError = true;
      if (!isNonEmptyString(diagnostic.message)) addIssue(issues, `${path}.message`, 'is required');
      if (diagnostic.path !== undefined && !isNonEmptyString(diagnostic.path)) {
        addIssue(issues, `${path}.path`, 'must be a non-empty string when present');
      }
    });
    if (status === 'FAILED' && !hasError) {
      addIssue(issues, '$.diagnostics', 'must contain an error for a failed response');
    }
    if (status === 'COMPLETED' && hasError) {
      addIssue(issues, '$.diagnostics', 'must not contain errors for a completed response');
    }
  }

  private validateWarnings(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, '$.warnings', 'must be an array');
      return;
    }
    value.forEach((warning, index) => {
      if (isRecord(warning)) {
        validateExactKeys(warning, ['code', 'message'], `$.warnings[${index}]`, issues);
      }
      if (
        !isRecord(warning) ||
        !isNonEmptyString(warning.code) ||
        !isNonEmptyString(warning.message)
      ) {
        addIssue(issues, `$.warnings[${index}]`, 'must contain a code and message');
      }
    });
  }

  private validateStatistics(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, '$.statistics', 'must be an object');
      return;
    }
    validateExactKeys(value, ['startedAt', 'completedAt', 'durationMs'], '$.statistics', issues);
    const startedAt = parseTimestamp(value.startedAt);
    const completedAt = parseTimestamp(value.completedAt);
    if (startedAt === undefined)
      addIssue(issues, '$.statistics.startedAt', 'must be an ISO timestamp');
    if (completedAt === undefined)
      addIssue(issues, '$.statistics.completedAt', 'must be an ISO timestamp');
    if (!isNonNegativeSafeInteger(value.durationMs)) {
      addIssue(issues, '$.statistics.durationMs', 'must be a non-negative safe integer');
    }
    if (
      startedAt !== undefined &&
      completedAt !== undefined &&
      isNonNegativeSafeInteger(value.durationMs) &&
      (completedAt < startedAt || completedAt - startedAt !== value.durationMs)
    ) {
      addIssue(issues, '$.statistics', 'timestamps and durationMs must describe the same interval');
    }
  }

  private validateUsage(
    value: unknown,
    artifacts: unknown,
    issues: ProviderValidationIssue[],
  ): void {
    if (!isRecord(value)) {
      addIssue(issues, '$.usage', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['inputCharacters', 'promptCharacters', 'outputCharacters', 'artifactCount'],
      '$.usage',
      issues,
    );
    for (const field of [
      'inputCharacters',
      'promptCharacters',
      'outputCharacters',
      'artifactCount',
    ] as const) {
      if (!isNonNegativeSafeInteger(value[field])) {
        addIssue(issues, `$.usage.${field}`, 'must be a non-negative safe integer');
      }
    }
    if (
      Array.isArray(artifacts) &&
      isNonNegativeSafeInteger(value.artifactCount) &&
      value.artifactCount !== artifacts.length
    ) {
      addIssue(issues, '$.usage.artifactCount', 'must equal artifacts.length');
    }
  }
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value
    ? undefined
    : timestamp;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (!Array.isArray(value)) {
    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function isSafeRelativePath(value: string): boolean {
  return (
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !/^[a-zA-Z]:/.test(value) &&
    !value.includes('\\') &&
    value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
  );
}
