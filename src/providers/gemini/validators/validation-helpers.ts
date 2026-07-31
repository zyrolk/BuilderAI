import type { ProviderValidationIssue } from '../../../core/ai-provider';

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

export function addIssue(issues: ProviderValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

export function validateExactKeys(
  value: object,
  keys: readonly string[],
  path: string,
  issues: ProviderValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) addIssue(issues, `${path}.${key}`, 'is not allowed');
  }
}
