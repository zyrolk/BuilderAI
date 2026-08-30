/**
 * ADR-052 Slice 2 — server-only correction prepare envelope.
 * Separate from AGENT_OPERATING_PLAN_PREPARE / verificationPlanningContext.
 */

import { WorkspaceRuntimeError } from '../workspace-runtime.types';
import type { IterationFeedback } from '../iteration-feedback.types';
import {
  validateBoundedFailureDiagnostic,
  type BoundedFailureDiagnostic,
} from '../failure-diagnostics';

export const CORRECTION_PREPARE_KIND = 'CORRECTION_PREPARE' as const;

export const CLIENT_FORBIDDEN_FAILURE_DIAGNOSTIC_KEYS = [
  'structuredFailureDiagnostics',
  'failureDiagnostics',
  'boundedFailureDiagnostics',
  'diagnosticSource',
  'diagnosticCommandId',
] as const;

/** Server-owned prepare input — never accepted from HTTP. */
export interface CorrectionPrepareInput {
  readonly kind: typeof CORRECTION_PREPARE_KIND;
  readonly iterationFeedback: IterationFeedback;
  readonly structuredFailureDiagnostics?: readonly BoundedFailureDiagnostic[];
}

export function isCorrectionPrepareInput(value: unknown): value is CorrectionPrepareInput {
  if (typeof value !== 'object' || value === null) return false;
  if (Reflect.get(value, 'kind') !== CORRECTION_PREPARE_KIND) return false;
  const feedback = Reflect.get(value, 'iterationFeedback');
  if (typeof feedback !== 'object' || feedback === null) return false;
  const diagnostics = Reflect.get(value, 'structuredFailureDiagnostics');
  if (diagnostics === undefined) return true;
  return Array.isArray(diagnostics);
}

export function buildCorrectionPrepareInput(input: {
  readonly iterationFeedback: IterationFeedback;
  readonly structuredFailureDiagnostics?: readonly BoundedFailureDiagnostic[];
}): CorrectionPrepareInput {
  const diagnostics = sanitizeStructuredFailureDiagnostics(input.structuredFailureDiagnostics);
  return {
    kind: CORRECTION_PREPARE_KIND,
    iterationFeedback: input.iterationFeedback,
    ...(diagnostics.length === 0 ? {} : { structuredFailureDiagnostics: diagnostics }),
  };
}

export function sanitizeStructuredFailureDiagnostics(
  value: readonly BoundedFailureDiagnostic[] | undefined,
): readonly BoundedFailureDiagnostic[] {
  if (value === undefined) return [];
  return value.filter((diagnostic) => validateBoundedFailureDiagnostic(diagnostic));
}

export function assertNoClientFailureDiagnosticAuthority(body: object): void {
  for (const key of CLIENT_FORBIDDEN_FAILURE_DIAGNOSTIC_KEYS) {
    if (Reflect.has(body, key)) {
      throw new WorkspaceRuntimeError(
        'INVALID_REQUEST',
        `Client-supplied ${key} is not accepted; server-derived diagnostics are authoritative.`,
      );
    }
  }
}
