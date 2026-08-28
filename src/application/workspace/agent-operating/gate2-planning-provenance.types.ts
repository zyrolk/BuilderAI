export const GATE2_PLANNING_PROVENANCE_SCHEMA_VERSION = 1 as const;

export const GATE2_PLANNING_PROVENANCE_LIMITS = {
  MAX_PATH_HINTS: 8,
} as const;

/** Read-only Gate2 display artifact (ADR-048). DATA only — never authority. */
export interface Gate2PlanningProvenanceReview {
  readonly schemaVersion: typeof GATE2_PLANNING_PROVENANCE_SCHEMA_VERSION;

  readonly hasP0Context: boolean;
  readonly hasOperatorContext: boolean;

  readonly p0PathHintCount: number;
  readonly operatorPathHintCount: number;
  readonly mergedPathHintCount: number;
  readonly plannedOperationCount: number;
  readonly plannedPathOverlapCount: number;
  readonly unmatchedMergedHintCount: number;

  readonly p0OnlyPathHints: readonly string[];
  readonly operatorOnlyPathHints: readonly string[];
  readonly mergedPathHints: readonly string[];
  readonly matchedPlannedPaths: readonly string[];
  readonly unmatchedMergedPathHints: readonly string[];

  readonly truncated: boolean;
}
