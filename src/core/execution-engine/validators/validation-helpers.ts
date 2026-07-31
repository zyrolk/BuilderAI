import type { ExecutionValidationCode, ExecutionValidationIssue } from '../types';

export const EXECUTION_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const EXECUTION_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function parseIsoTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value
    ? undefined
    : timestamp;
}

export function addIssue(
  issues: ExecutionValidationIssue[],
  code: ExecutionValidationCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function validateExactKeys(
  value: object,
  allowedKeys: readonly string[],
  path: string,
  issues: ExecutionValidationIssue[],
  code: ExecutionValidationCode,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) addIssue(issues, code, `${path}.${key}`, 'is not allowed');
  }
}

export function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export function validateScalarMetadata(
  value: unknown,
  path: string,
  maximumEntries: number,
  issues: ExecutionValidationIssue[],
  code: ExecutionValidationCode,
): void {
  if (!isRecord(value)) {
    addIssue(issues, code, path, 'must be an object');
    return;
  }
  if (Object.keys(value).length > maximumEntries) {
    addIssue(issues, code, path, `must contain at most ${maximumEntries} entries`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!EXECUTION_IDENTIFIER_PATTERN.test(key)) {
      addIssue(issues, code, `${path}.${key}`, 'has an invalid key');
    }
    if (
      !['string', 'number', 'boolean'].includes(typeof entry) ||
      (typeof entry === 'number' && !Number.isFinite(entry))
    ) {
      addIssue(issues, code, `${path}.${key}`, 'must be a string, finite number, or boolean');
    }
  }
}
