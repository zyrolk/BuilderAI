import { ITERATION_FEEDBACK_SCHEMA_VERSION } from '../iteration-feedback.types';

export const INVESTIGATION_HANDOFF_KIND = 'INVESTIGATION_HANDOFF' as const;

export interface InvestigationHandoffFeedback {
  readonly schemaVersion: typeof ITERATION_FEEDBACK_SCHEMA_VERSION;
  readonly kind: typeof INVESTIGATION_HANDOFF_KIND;
  readonly sourceInvestigationId: string;
  readonly priorRequestSummary: string;
  readonly investigationSummary: string;
  readonly suggestedFixScope?: string;
  readonly pathHints: readonly string[];
}

export function buildInvestigationHandoffFeedback(input: {
  readonly sourceInvestigationId: string;
  readonly priorRequestSummary: string;
  readonly investigationSummary: string;
  readonly suggestedFixScope?: string;
  readonly pathHints: readonly string[];
}): InvestigationHandoffFeedback {
  return {
    schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
    kind: INVESTIGATION_HANDOFF_KIND,
    sourceInvestigationId: input.sourceInvestigationId,
    priorRequestSummary: input.priorRequestSummary.slice(0, 500),
    investigationSummary: input.investigationSummary.slice(0, 800),
    ...(input.suggestedFixScope === undefined
      ? {}
      : { suggestedFixScope: input.suggestedFixScope.slice(0, 500) }),
    pathHints: [...new Set(input.pathHints.map((path) => path.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
      .slice(0, 8),
  };
}

export function isInvestigationHandoffFeedback(
  value: unknown,
): value is InvestigationHandoffFeedback {
  if (typeof value !== 'object' || value === null) return false;
  return (
    Reflect.get(value, 'schemaVersion') === ITERATION_FEEDBACK_SCHEMA_VERSION &&
    Reflect.get(value, 'kind') === INVESTIGATION_HANDOFF_KIND &&
    typeof Reflect.get(value, 'sourceInvestigationId') === 'string' &&
    typeof Reflect.get(value, 'priorRequestSummary') === 'string' &&
    typeof Reflect.get(value, 'investigationSummary') === 'string' &&
    Array.isArray(Reflect.get(value, 'pathHints'))
  );
}

export function extractInvestigationHandoffPathHints(
  feedback: InvestigationHandoffFeedback,
): readonly string[] {
  return feedback.pathHints;
}
