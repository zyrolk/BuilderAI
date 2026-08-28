import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import type { Gate2ReviewProjection } from '../gate2-review';
import type { InvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import type { IterationFeedback } from '../iteration-feedback.types';
import type { OperatorToolPlanningContext } from './operator-tool-planning-context';
import {
  isOperatorToolPlanningMergeInput,
  type OperatorToolPlanningMergeInput,
} from './operator-tool-planning-prepare-input';
import {
  GATE2_PLANNING_PROVENANCE_LIMITS,
  GATE2_PLANNING_PROVENANCE_SCHEMA_VERSION,
  type Gate2PlanningProvenanceReview,
} from './gate2-planning-provenance.types';

export interface AssembleGate2PlanningProvenanceInput {
  readonly handoff?: InvestigationHandoffFeedback;
  readonly operatorContext?: OperatorToolPlanningContext;
  readonly merged?: OperatorToolPlanningMergeInput | InvestigationHandoffFeedback;
  readonly gate2Review: Gate2ReviewProjection;
  /** Correction-plan only: paths from iteration feedback apply evidence (no operator merge). */
  readonly correctionPathHints?: readonly string[];
}

/** Pure deterministic Gate2 planning provenance (ADR-048). No I/O, no provider, no tools. */
export function assembleGate2PlanningProvenance(
  input: AssembleGate2PlanningProvenanceInput,
): Gate2PlanningProvenanceReview {
  const { handoff, operatorContext, gate2Review } = input;
  const hasP0Context = handoff !== undefined;
  const hasOperatorContext = operatorContext !== undefined;

  const p0Paths = collectHandoffPaths(handoff);
  const operatorPaths = collectOperatorPaths(operatorContext);
  const mergedPaths =
    input.correctionPathHints !== undefined
      ? normalizePathSet(input.correctionPathHints)
      : collectHandoffPaths(resolveMergedHandoff(input.merged));

  const p0OnlyFull = differencePaths(p0Paths, operatorPaths);
  const operatorOnlyFull = differencePaths(operatorPaths, p0Paths);
  const plannedPaths = normalizePathSet(
    gate2Review.operationDiffs.map((operation) => operation.logicalPath),
  );
  const matchedFull = intersectPaths(mergedPaths, plannedPaths);
  const unmatchedFull = differencePaths(mergedPaths, plannedPaths);

  const p0OnlyPathHints = truncatePathList(p0OnlyFull);
  const operatorOnlyPathHints = truncatePathList(operatorOnlyFull);
  const mergedPathHints = truncatePathList(mergedPaths);
  const matchedPlannedPaths = truncatePathList(matchedFull);
  const unmatchedMergedPathHints = truncatePathList(unmatchedFull);

  const truncated =
    p0OnlyFull.length > p0OnlyPathHints.length ||
    operatorOnlyFull.length > operatorOnlyPathHints.length ||
    mergedPaths.length > mergedPathHints.length ||
    matchedFull.length > matchedPlannedPaths.length ||
    unmatchedFull.length > unmatchedMergedPathHints.length;

  return {
    schemaVersion: GATE2_PLANNING_PROVENANCE_SCHEMA_VERSION,
    hasP0Context,
    hasOperatorContext,
    p0PathHintCount: p0Paths.length,
    operatorPathHintCount: operatorPaths.length,
    mergedPathHintCount: mergedPaths.length,
    plannedOperationCount: gate2Review.operationDiffs.length,
    plannedPathOverlapCount: matchedFull.length,
    unmatchedMergedHintCount: unmatchedFull.length,
    p0OnlyPathHints,
    operatorOnlyPathHints,
    mergedPathHints,
    matchedPlannedPaths,
    unmatchedMergedPathHints,
    truncated,
  };
}

export function extractCorrectionPlanningPathHints(feedback: IterationFeedback): readonly string[] {
  const raw = [
    ...feedback.apply.createdPaths,
    ...feedback.apply.updatedPaths,
    ...feedback.apply.deletedPaths,
    ...(feedback.preservationRejection?.unrequestedPaths ?? []),
  ];
  return normalizePathSet(raw);
}

function resolveMergedHandoff(
  merged: OperatorToolPlanningMergeInput | InvestigationHandoffFeedback | undefined,
): InvestigationHandoffFeedback | undefined {
  if (merged === undefined) return undefined;
  if (isOperatorToolPlanningMergeInput(merged)) return merged.mergedHandoff;
  return merged;
}

function collectHandoffPaths(handoff: InvestigationHandoffFeedback | undefined): readonly string[] {
  if (handoff === undefined) return [];
  return normalizePathSet([
    ...handoff.pathHints,
    ...handoff.existingPathHints,
    ...handoff.candidatePathHints,
  ]);
}

function collectOperatorPaths(
  operatorContext: OperatorToolPlanningContext | undefined,
): readonly string[] {
  if (operatorContext === undefined) return [];
  return normalizePathSet([
    ...operatorContext.mergedPathHints,
    ...operatorContext.mergedExistingPathHints,
    ...operatorContext.mergedCandidatePathHints,
  ]);
}

function normalizePathSet(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  ordered.sort((left, right) => left.localeCompare(right));
  return ordered;
}

function normalizePath(path: string): string | undefined {
  const trimmed = path.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return normalizeProjectPath(trimmed);
  } catch {
    return undefined;
  }
}

function differencePaths(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return left.filter((path) => !rightSet.has(path));
}

function intersectPaths(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return left.filter((path) => rightSet.has(path));
}

function truncatePathList(paths: readonly string[]): readonly string[] {
  return paths.slice(0, GATE2_PLANNING_PROVENANCE_LIMITS.MAX_PATH_HINTS);
}
