/**
 * ADR-052 — BoundedFailureDiagnostic types (P1-E Slice 1).
 * Separate from BoundedVerificationEvidence and VerificationPlanningProjection.
 */

import type { ControlledTerminalCommandId } from '../controlled-terminal/controlled-terminal.types';

export const BOUNDED_FAILURE_DIAGNOSTIC_SOURCES = ['TYPESCRIPT', 'ESLINT', 'VITEST'] as const;

export type BoundedFailureDiagnosticSource = (typeof BOUNDED_FAILURE_DIAGNOSTIC_SOURCES)[number];

export const BOUNDED_FAILURE_DIAGNOSTIC_SEVERITIES = ['ERROR', 'WARNING'] as const;

export type BoundedFailureDiagnosticSeverity =
  (typeof BOUNDED_FAILURE_DIAGNOSTIC_SEVERITIES)[number];

/** Server-derived structured failure location — planning DATA only; not mutation authority. */
export interface BoundedFailureDiagnostic {
  readonly schemaVersion: 1;
  readonly source: BoundedFailureDiagnosticSource;
  readonly commandId: ControlledTerminalCommandId;
  readonly severity: BoundedFailureDiagnosticSeverity;
  readonly code?: string;
  readonly relativePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly boundedMessage?: string;
}

/** Parser-internal draft before validation — never exposed publicly. */
export interface FailureDiagnosticDraft {
  readonly source: BoundedFailureDiagnosticSource;
  readonly commandId: ControlledTerminalCommandId;
  readonly severity: BoundedFailureDiagnosticSeverity;
  readonly code?: string;
  readonly relativePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly boundedMessage?: string;
}

export interface ExtractBoundedFailureDiagnosticsInput {
  readonly commandId: ControlledTerminalCommandId;
  readonly projectRoot: string;
  /** Bounded diagnostic text — typically ControlledTerminalRunResult.diagnosticSummary. */
  readonly diagnosticText: string;
  readonly executionStatus?:
    'FAILED' | 'SUCCEEDED' | 'TIMEOUT' | 'CANCELLED' | 'REJECTED_BY_POLICY';
}
