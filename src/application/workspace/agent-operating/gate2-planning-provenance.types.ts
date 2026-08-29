import type {
  VerificationBaselineStatus,
  VerificationPlanningProjection,
} from './verification-planning-projection';
import type { ControlledTerminalCommandId } from '../controlled-terminal/controlled-terminal.types';

export const GATE2_PLANNING_PROVENANCE_SCHEMA_VERSION = 1 as const;

export const GATE2_PLANNING_PROVENANCE_LIMITS = {
  MAX_PATH_HINTS: 8,
} as const;

/** Additive verification influence section (ADR-051). DATA only — never authority. */
export interface Gate2VerificationPlanningProvenance {
  readonly hasVerificationContext: true;
  readonly baselineStatus: VerificationBaselineStatus;
  readonly consideredCommandCount: number;
  readonly failedCommandIds: readonly ControlledTerminalCommandId[];
  readonly blockedCommandIds: readonly ControlledTerminalCommandId[];
  readonly timedOutCommandIds: readonly ControlledTerminalCommandId[];
  readonly cancelledCommandIds: readonly ControlledTerminalCommandId[];
  readonly succeededCommandIds: readonly ControlledTerminalCommandId[];
}

/** Read-only Gate2 display artifact (ADR-048 / ADR-051). DATA only — never authority. */
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

  /** Present only when the same VerificationPlanningProjection reached prepare (ADR-051). */
  readonly verification?: Gate2VerificationPlanningProvenance;
}

export function toGate2VerificationProvenance(
  projection: VerificationPlanningProjection,
): Gate2VerificationPlanningProvenance {
  return {
    hasVerificationContext: true,
    baselineStatus: projection.baselineStatus,
    consideredCommandCount: projection.consideredCommandIds.length,
    failedCommandIds: projection.failedCommandIds,
    blockedCommandIds: projection.blockedCommandIds,
    timedOutCommandIds: projection.timedOutCommandIds,
    cancelledCommandIds: projection.cancelledCommandIds,
    succeededCommandIds: projection.succeededCommandIds,
  };
}
