import type { ProviderValidationIssue } from '../types';

export const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value > 0;
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0;
}

export function addIssue(issues: ProviderValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

export function validateExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
  issues: ProviderValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) addIssue(issues, `${path}.${key}`, 'is not allowed');
  }
}

export function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

export function validateMetadata(
  value: unknown,
  path: string,
  issues: ProviderValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, path, 'must be an object');
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!IDENTIFIER_PATTERN.test(key)) addIssue(issues, `${path}.${key}`, 'has an invalid key');
    if (
      !['string', 'number', 'boolean'].includes(typeof item) ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      addIssue(issues, `${path}.${key}`, 'must be a string, finite number, or boolean');
    }
  }
}

export function validateStringArray(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: ProviderValidationIssue[],
  allowEmpty: boolean,
): value is readonly string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'must be an array');
    return false;
  }
  if (!allowEmpty && value.length === 0) addIssue(issues, path, 'must not be empty');
  const strings = value.filter((item): item is string => typeof item === 'string');
  if (strings.length !== value.length) addIssue(issues, path, 'must contain only strings');
  for (const item of strings) {
    if (!allowed.includes(item)) addIssue(issues, path, `contains unsupported value '${item}'`);
  }
  for (const duplicate of duplicateValues(strings)) {
    addIssue(issues, path, `contains duplicate '${duplicate}'`);
  }
  return strings.length === value.length;
}
