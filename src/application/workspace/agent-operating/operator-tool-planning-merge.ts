import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import {
  ITERATION_FEEDBACK_SCHEMA_VERSION,
  ITERATION_FEEDBACK_LIMITS,
} from '../iteration-feedback.types';
import {
  INVESTIGATION_HANDOFF_KIND,
  type InvestigationHandoffFeedback,
} from '../investigation/investigation-handoff';
import type { OperatorToolPlanningProjection } from '../agent-loop/agent-loop.types';
import type { OperatorToolPlanningContext } from './operator-tool-planning-context';
import type { OperatorToolPlanningMergeInput } from './operator-tool-planning-prepare-input';
import { OPERATOR_TOOL_PLANNING_MERGE_KIND } from './operator-tool-planning-prepare-input';

const OPERATOR_APPENDIX_HEADER = 'Operator tool investigation (read-only; not applied)' as const;

export interface MergeOperatorToolPlanningInput {
  readonly handoff: InvestigationHandoffFeedback | undefined;
  readonly operatorContext: OperatorToolPlanningContext | undefined;
  readonly existingSourcePaths?: readonly string[];
}

/**
 * Deterministic P0 + operator merge (ADR-047). P0 retains semantic precedence.
 * Returns undefined when neither P0 nor operator context contributes planning hints.
 */
export function mergeOperatorToolPlanningWithHandoff(
  input: MergeOperatorToolPlanningInput,
): OperatorToolPlanningMergeInput | InvestigationHandoffFeedback | undefined {
  const { handoff, operatorContext } = input;
  if (handoff === undefined && operatorContext === undefined) return undefined;
  if (operatorContext === undefined) return handoff;

  const existingSet = buildExistingPathSet(input.existingSourcePaths);
  const p0Existing = dedupePaths(handoff?.existingPathHints ?? []);
  const p0Candidates = dedupePaths(handoff?.candidatePathHints ?? []);
  const p0General = dedupePaths(handoff?.pathHints ?? []);

  const operatorExisting = dedupePaths(operatorContext.mergedExistingPathHints);
  const operatorCandidates = dedupePaths(operatorContext.mergedCandidatePathHints);

  const mergedExistingBase = mergeExistingPaths(p0Existing, operatorExisting, existingSet);
  const candidateMerge = mergeCandidatePaths(
    p0Candidates,
    operatorCandidates,
    operatorContext.records,
    mergedExistingBase,
    existingSet,
  );
  const mergedExisting = dedupePaths([...mergedExistingBase, ...candidateMerge.promotedExisting]);
  const mergedCandidates = candidateMerge.candidates;
  const mergedPathHints = mergeGeneralPathHints(
    p0General,
    operatorContext.records,
    mergedExisting,
    mergedCandidates,
  );

  const mergedHandoff: InvestigationHandoffFeedback = {
    schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
    kind: INVESTIGATION_HANDOFF_KIND,
    sourceInvestigationId:
      handoff?.sourceInvestigationId ??
      `operator-tool-${operatorContext.records[0]?.sourceRunId ?? 'unknown'}`,
    priorRequestSummary: handoff?.priorRequestSummary ?? '',
    investigationSummary: buildMergedInvestigationSummary(handoff, operatorContext),
    ...(handoff?.suggestedFixScope === undefined
      ? {}
      : { suggestedFixScope: handoff.suggestedFixScope }),
    pathHints: mergedPathHints,
    existingPathHints: mergedExisting,
    candidatePathHints: mergedCandidates,
  };

  return {
    kind: OPERATOR_TOOL_PLANNING_MERGE_KIND,
    mergedHandoff,
  };
}

function buildExistingPathSet(paths: readonly string[] | undefined): ReadonlySet<string> {
  const set = new Set<string>();
  if (paths === undefined) return set;
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized !== undefined) set.add(normalized);
  }
  return set;
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

function dedupePaths(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

function mergeExistingPaths(
  p0Existing: readonly string[],
  operatorExisting: readonly string[],
  existingSet: ReadonlySet<string>,
): readonly string[] {
  const p0Set = new Set(p0Existing);
  const ordered = [...p0Existing];
  const seen = new Set(p0Existing);

  for (const path of operatorExisting) {
    if (seen.has(path)) continue;
    if (p0Set.has(path)) continue;
    seen.add(path);
    ordered.push(path);
  }

  for (const path of operatorExisting) {
    if (existingSet.has(path) && !seen.has(path)) {
      seen.add(path);
      ordered.push(path);
    }
  }

  return ordered.slice(0, ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS);
}

function mergeCandidatePaths(
  p0Candidates: readonly string[],
  operatorCandidates: readonly string[],
  operatorRecords: readonly OperatorToolPlanningProjection[],
  mergedExisting: readonly string[],
  existingSet: ReadonlySet<string>,
): { readonly candidates: readonly string[]; readonly promotedExisting: readonly string[] } {
  const existingLookup = new Set(mergedExisting);
  const p0CandidateSet = new Set(p0Candidates);
  const ordered: string[] = [];
  const promotedExisting: string[] = [];
  const seen = new Set<string>();

  const addCandidate = (path: string): void => {
    if (seen.has(path) || existingLookup.has(path)) return;
    if (existingSet.has(path)) {
      if (!existingLookup.has(path)) {
        existingLookup.add(path);
        promotedExisting.push(path);
      }
      return;
    }
    seen.add(path);
    ordered.push(path);
  };

  for (const path of p0Candidates) addCandidate(path);
  for (const path of operatorCandidates) {
    if (p0CandidateSet.has(path)) continue;
    addCandidate(path);
  }

  for (const record of operatorRecords) {
    for (const path of dedupePaths(record.pathHints ?? [])) {
      if (p0CandidateSet.has(path) || existingLookup.has(path)) continue;
      addCandidate(path);
    }
  }

  return {
    candidates: ordered.slice(0, ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS),
    promotedExisting: dedupePaths(promotedExisting),
  };
}

function mergeGeneralPathHints(
  p0PathHints: readonly string[],
  operatorRecords: readonly OperatorToolPlanningProjection[],
  mergedExisting: readonly string[],
  mergedCandidates: readonly string[],
): readonly string[] {
  const cap = ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS;
  const classified = new Set([...mergedExisting, ...mergedCandidates]);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (path: string): void => {
    if (seen.has(path) || ordered.length >= cap) return;
    seen.add(path);
    ordered.push(path);
  };

  for (const path of p0PathHints) push(path);

  for (const record of operatorRecords) {
    for (const path of dedupePaths([
      ...(record.pathHints ?? []),
      ...(record.existingPathHints ?? []),
      ...(record.candidatePathHints ?? []),
    ])) {
      if (classified.has(path)) continue;
      push(path);
    }
  }

  for (const path of mergedExisting) push(path);
  for (const path of mergedCandidates) push(path);

  return ordered.slice(0, cap);
}

function buildMergedInvestigationSummary(
  handoff: InvestigationHandoffFeedback | undefined,
  operatorContext: OperatorToolPlanningContext,
): string {
  const p0Summary = handoff?.investigationSummary ?? '';
  const operatorBlock = [
    OPERATOR_APPENDIX_HEADER,
    operatorContext.provenanceSummary,
    ...(operatorContext.truncated ? ['- operator path hints truncated to policy cap'] : []),
  ].join('\n');

  if (p0Summary.length === 0) return operatorBlock.slice(0, 800);
  return `${p0Summary}\n\n${operatorBlock}`.slice(0, 800);
}
