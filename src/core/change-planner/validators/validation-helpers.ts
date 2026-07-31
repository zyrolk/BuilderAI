import type { ChangePlanValidationCode, ChangePlanValidationIssue } from '../types';

export const METADATA_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHECKSUM_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CHECKSUM_VALUE_PATTERN = /^[a-f0-9]+$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function addIssue(
  issues: ChangePlanValidationIssue[],
  code: ChangePlanValidationCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function validateExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ChangePlanValidationIssue[],
  code: ChangePlanValidationCode = 'INVALID_CHANGE_PLAN',
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) addIssue(issues, code, `${path}.${key}`, 'is not allowed');
  }
}

export function validateMetadata(
  value: unknown,
  path: string,
  issues: ChangePlanValidationIssue[],
  maximumEntries: number,
  maximumStringCharacters: number,
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'INVALID_METADATA', path, 'must be an object');
    return;
  }
  const entries = Object.entries(value);
  if (entries.length > maximumEntries) {
    addIssue(issues, 'INVALID_METADATA', path, `must contain at most ${maximumEntries} entries`);
  }
  for (const [key, item] of entries) {
    if (!METADATA_KEY_PATTERN.test(key)) {
      addIssue(issues, 'INVALID_METADATA', `${path}.${key}`, 'has an invalid key');
    }
    if (
      !['string', 'number', 'boolean'].includes(typeof item) ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      addIssue(issues, 'INVALID_METADATA', `${path}.${key}`, 'must be a scalar JSON value');
    }
    if (typeof item === 'string' && item.length > maximumStringCharacters) {
      addIssue(
        issues,
        'INVALID_METADATA',
        `${path}.${key}`,
        `must contain at most ${maximumStringCharacters} characters`,
      );
    }
  }
}

export function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || compareText(values[index - 1] ?? '', value) <= 0,
  );
}
