import type { ResponseMetadata } from '../../response-processor';
import type {
  VerificationDiagnostic,
  VerificationMessage,
  VerificationValidationCode,
  VerificationValidationIssue,
} from '../types';

const METADATA_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function addIssue(
  issues: VerificationValidationIssue[],
  code: VerificationValidationCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

export function validateOptionalDiagnostic(
  value: unknown,
  path: string,
  issues: VerificationValidationIssue[],
  code: VerificationValidationCode,
  configuration: {
    readonly maximumStdoutCharacters: number;
    readonly maximumStderrCharacters: number;
    readonly maximumCombinedCharacters: number;
  },
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    addIssue(issues, code, path, 'must be an object');
    return;
  }
  const allowedKeys = [
    'commandLabel',
    'exitCode',
    'stdoutExcerpt',
    'stderrExcerpt',
    'truncated',
    'omittedBytes',
  ] as const;
  for (const key of allowedKeys) {
    if (!(key in value)) continue;
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key as (typeof allowedKeys)[number])) {
      addIssue(issues, code, `${path}.${key}`, 'is not allowed');
    }
  }
  if ('commandLabel' in value && typeof value.commandLabel !== 'string') {
    addIssue(issues, code, `${path}.commandLabel`, 'must be a string');
  }
  if (
    'commandLabel' in value &&
    typeof value.commandLabel === 'string' &&
    value.commandLabel.length > 240
  ) {
    addIssue(issues, code, `${path}.commandLabel`, 'must contain at most 240 characters');
  }
  if (
    'exitCode' in value &&
    value.exitCode !== undefined &&
    (typeof value.exitCode !== 'number' || !Number.isFinite(value.exitCode))
  ) {
    addIssue(issues, code, `${path}.exitCode`, 'must be a finite number');
  }
  if ('stdoutExcerpt' in value && typeof value.stdoutExcerpt !== 'string') {
    addIssue(issues, code, `${path}.stdoutExcerpt`, 'must be a string');
  }
  if (
    'stdoutExcerpt' in value &&
    typeof value.stdoutExcerpt === 'string' &&
    value.stdoutExcerpt.length > configuration.maximumStdoutCharacters
  ) {
    addIssue(
      issues,
      code,
      `${path}.stdoutExcerpt`,
      `must contain at most ${configuration.maximumStdoutCharacters} characters`,
    );
  }
  if ('stderrExcerpt' in value && typeof value.stderrExcerpt !== 'string') {
    addIssue(issues, code, `${path}.stderrExcerpt`, 'must be a string');
  }
  if (
    'stderrExcerpt' in value &&
    typeof value.stderrExcerpt === 'string' &&
    value.stderrExcerpt.length > configuration.maximumStderrCharacters
  ) {
    addIssue(
      issues,
      code,
      `${path}.stderrExcerpt`,
      `must contain at most ${configuration.maximumStderrCharacters} characters`,
    );
  }
  if ('truncated' in value && typeof value.truncated !== 'boolean') {
    addIssue(issues, code, `${path}.truncated`, 'must be a boolean');
  }
  if (
    'omittedBytes' in value &&
    value.omittedBytes !== undefined &&
    (!isNonNegativeFiniteNumber(value.omittedBytes) || value.omittedBytes === 0)
  ) {
    addIssue(issues, code, `${path}.omittedBytes`, 'must be a positive finite number when present');
  }
  if (
    isRecord(value) &&
    typeof value.stdoutExcerpt === 'string' &&
    typeof value.stderrExcerpt === 'string'
  ) {
    const combined = value.stdoutExcerpt.length + value.stderrExcerpt.length;
    if (combined > configuration.maximumCombinedCharacters) {
      addIssue(
        issues,
        code,
        path,
        `combined diagnostic excerpts must contain at most ${configuration.maximumCombinedCharacters} characters`,
      );
    }
  }
}

export function normalizeDiagnostic(
  diagnostic: VerificationDiagnostic | undefined,
): VerificationDiagnostic | undefined {
  if (diagnostic === undefined) return undefined;
  return {
    ...(diagnostic.commandLabel === undefined ? {} : { commandLabel: diagnostic.commandLabel }),
    ...(diagnostic.exitCode === undefined ? {} : { exitCode: diagnostic.exitCode }),
    ...(diagnostic.stdoutExcerpt === undefined ? {} : { stdoutExcerpt: diagnostic.stdoutExcerpt }),
    ...(diagnostic.stderrExcerpt === undefined ? {} : { stderrExcerpt: diagnostic.stderrExcerpt }),
    truncated: diagnostic.truncated,
    ...(diagnostic.omittedBytes === undefined ? {} : { omittedBytes: diagnostic.omittedBytes }),
  };
}

export function validateRequiredKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  issues: VerificationValidationIssue[],
  code: VerificationValidationCode,
): void {
  for (const key of required) {
    if (!(key in value)) addIssue(issues, code, `${path}.${key}`, 'is required');
  }
}

export function validateExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  issues: VerificationValidationIssue[],
  code: VerificationValidationCode,
): void {
  validateRequiredKeys(value, required, path, issues, code);
  for (const key of Object.keys(value)) {
    if (!required.includes(key)) addIssue(issues, code, `${path}.${key}`, 'is not allowed');
  }
}

export function validateMetadata(
  value: unknown,
  path: string,
  issues: VerificationValidationIssue[],
  code: VerificationValidationCode,
  maximumEntries: number,
  maximumStringCharacters: number,
  requireCanonicalOrder: boolean,
): void {
  if (!isRecord(value)) {
    addIssue(issues, code, path, 'must be an object');
    return;
  }
  const keys = Object.keys(value);
  if (keys.length > maximumEntries) {
    addIssue(issues, code, path, `must contain at most ${maximumEntries} entries`);
  }
  if (requireCanonicalOrder && !isSorted(keys)) {
    addIssue(issues, code, path, 'keys must use canonical order');
  }
  for (const [key, item] of Object.entries(value)) {
    if (!METADATA_KEY_PATTERN.test(key))
      addIssue(issues, code, `${path}.${key}`, 'has an invalid key');
    if (
      !['string', 'number', 'boolean'].includes(typeof item) ||
      (typeof item === 'number' && !Number.isFinite(item))
    ) {
      addIssue(issues, code, `${path}.${key}`, 'must be a scalar JSON value');
    }
    if (typeof item === 'string' && item.length > maximumStringCharacters) {
      addIssue(
        issues,
        code,
        `${path}.${key}`,
        `must contain at most ${maximumStringCharacters} characters`,
      );
    }
  }
}

export function validateMessages(
  value: unknown,
  path: string,
  issues: VerificationValidationIssue[],
  code: VerificationValidationCode,
  maximumCount: number,
  maximumMessageCharacters: number,
  requireCanonicalOrder: boolean,
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, code, path, 'must be an array');
    return;
  }
  if (value.length > maximumCount) {
    addIssue(issues, code, path, `must contain at most ${maximumCount} findings`);
  }
  const keys: string[] = [];
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, code, itemPath, 'must be an object');
      return;
    }
    validateExactKeys(item, ['code', 'message'], itemPath, issues, code);
    if (typeof item.code !== 'string' || item.code.length === 0) {
      addIssue(issues, code, `${itemPath}.code`, 'must be a non-empty string');
    }
    if (
      typeof item.message !== 'string' ||
      item.message.length === 0 ||
      item.message.length > maximumMessageCharacters
    ) {
      addIssue(
        issues,
        code,
        `${itemPath}.message`,
        `must contain between 1 and ${maximumMessageCharacters} characters`,
      );
    }
    if (typeof item.code === 'string' && typeof item.message === 'string') {
      keys.push(`${item.code}\0${item.message}`);
    }
  });
  if (new Set(keys).size !== keys.length)
    addIssue(issues, code, path, 'must not contain duplicates');
  if (requireCanonicalOrder && !isSorted(keys)) {
    addIssue(issues, code, path, 'must use canonical order');
  }
}

export function normalizeMessages(messages: readonly VerificationMessage[]): VerificationMessage[] {
  return [...messages]
    .map(({ code, message }) => ({ code, message }))
    .sort((left, right) =>
      compareText(`${left.code}\0${left.message}`, `${right.code}\0${right.message}`),
    );
}

export function normalizeMetadata(metadata: ResponseMetadata): ResponseMetadata {
  return Object.fromEntries(
    Object.entries(metadata).sort(([left], [right]) => compareText(left, right)),
  );
}

export function isSorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || compareText(values[index - 1] ?? '', value) <= 0,
  );
}
