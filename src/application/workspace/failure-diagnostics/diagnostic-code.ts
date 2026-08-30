/**
 * ADR-052 — bounded diagnostic code validation.
 */

import {
  FAILURE_DIAGNOSTIC_CODE_PATTERN,
  MAX_FAILURE_DIAGNOSTIC_CODE_LENGTH,
} from './failure-diagnostic.constants';

export function normalizeFailureDiagnosticCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FAILURE_DIAGNOSTIC_CODE_LENGTH) {
    return undefined;
  }
  if (/[\0-\x1f\x7f]/u.test(trimmed)) return undefined;
  if (!FAILURE_DIAGNOSTIC_CODE_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}
