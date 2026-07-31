import type { PromptValidationCode, PromptValidationIssue } from '../types';

export const PROMPT_IDENTIFIER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

export function addIssue(
  issues: PromptValidationIssue[],
  code: PromptValidationCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function validateExactKeys(
  value: object,
  allowedKeys: readonly string[],
  path: string,
  issues: PromptValidationIssue[],
  code: PromptValidationCode = 'INVALID_PROMPT_STRUCTURE',
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

export function normalizedContent(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function validateMetadata(
  value: unknown,
  path: string,
  issues: PromptValidationIssue[],
): void {
  if (!isRecord(value)) {
    addIssue(issues, 'INVALID_PROMPT_STRUCTURE', path, 'must be an object');
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!PROMPT_IDENTIFIER_PATTERN.test(key)) {
      addIssue(issues, 'INVALID_PROMPT_STRUCTURE', `${path}.${key}`, 'has an invalid key');
    }
    if (
      !['string', 'number', 'boolean'].includes(typeof entry) ||
      (typeof entry === 'number' && !Number.isFinite(entry))
    ) {
      addIssue(
        issues,
        'INVALID_PROMPT_STRUCTURE',
        `${path}.${key}`,
        'must be a string, finite number, or boolean',
      );
    }
  }
}
