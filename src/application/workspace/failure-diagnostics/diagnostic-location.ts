/**
 * ADR-052 — line/column validation for failure diagnostics.
 */

import {
  MAX_FAILURE_DIAGNOSTIC_COLUMN,
  MAX_FAILURE_DIAGNOSTIC_LINE,
} from './failure-diagnostic.constants';

export function normalizeFailureDiagnosticLine(value: unknown): number | undefined {
  return normalizePositiveBoundedInteger(value, MAX_FAILURE_DIAGNOSTIC_LINE);
}

export function normalizeFailureDiagnosticColumn(value: unknown): number | undefined {
  return normalizePositiveBoundedInteger(value, MAX_FAILURE_DIAGNOSTIC_COLUMN);
}

function normalizePositiveBoundedInteger(value: unknown, maximum: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) return undefined;
  return value;
}
