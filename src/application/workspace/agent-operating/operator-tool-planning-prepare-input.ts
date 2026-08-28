import type { InvestigationHandoffFeedback } from '../investigation/investigation-handoff';

export const OPERATOR_TOOL_PLANNING_MERGE_KIND = 'OPERATOR_TOOL_PLANNING_MERGE' as const;

/** Server-only prepare input — never accepted from HTTP (ADR-047). */
export interface OperatorToolPlanningMergeInput {
  readonly kind: typeof OPERATOR_TOOL_PLANNING_MERGE_KIND;
  readonly mergedHandoff: InvestigationHandoffFeedback;
}

export function isOperatorToolPlanningMergeInput(
  value: unknown,
): value is OperatorToolPlanningMergeInput {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, 'kind') === OPERATOR_TOOL_PLANNING_MERGE_KIND;
}
