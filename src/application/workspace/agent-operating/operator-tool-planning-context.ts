import type {
  BoundedToolEvidenceRecord,
  OperatorToolPlanningProjection,
} from '../agent-loop/agent-loop.types';
import { validateProjectionForPersistence } from '../agent-loop/operator-tool-planning-projection';

export interface OperatorToolPlanningContext {
  readonly records: readonly OperatorToolPlanningProjection[];
  readonly mergedPathHints: readonly string[];
  readonly mergedExistingPathHints: readonly string[];
  readonly mergedCandidatePathHints: readonly string[];
  readonly provenanceSummary: string;
  readonly truncated: boolean;
}

const PROVENANCE_SUMMARY_MAX = 800 as const;

/**
 * Build ephemeral operator planning context from hydrated evidence (ADR-047).
 * Malformed or missing projections are ignored.
 */
export function buildOperatorToolPlanningContext(
  evidence: readonly BoundedToolEvidenceRecord[],
): OperatorToolPlanningContext | undefined {
  const records = selectValidPlanningProjections(evidence);
  if (records.length === 0) return undefined;

  const mergedPathHints = unionProjectionPaths(records, 'pathHints');
  const mergedExistingPathHints = unionProjectionPaths(records, 'existingPathHints');
  const mergedCandidatePathHints = unionProjectionPaths(records, 'candidatePathHints');

  return {
    records,
    mergedPathHints,
    mergedExistingPathHints,
    mergedCandidatePathHints,
    provenanceSummary: buildProvenanceSummary(records),
    truncated: records.some((record) => record.truncated === true),
  };
}

function selectValidPlanningProjections(
  evidence: readonly BoundedToolEvidenceRecord[],
): OperatorToolPlanningProjection[] {
  const selected: OperatorToolPlanningProjection[] = [];
  for (const record of evidence) {
    if (record.phase !== 'UNDERSTANDING') continue;
    if (record.status !== 'SUCCEEDED' && record.status !== 'REPLAYED') continue;
    const projection = record.planningProjection;
    if (projection === undefined) continue;
    if (!validateProjectionForPersistence(projection)) continue;
    selected.push(projection);
  }
  selected.sort(compareProjectionOrder);
  return selected;
}

function compareProjectionOrder(
  left: OperatorToolPlanningProjection,
  right: OperatorToolPlanningProjection,
): number {
  const timeCompare = left.recordedAt.localeCompare(right.recordedAt);
  if (timeCompare !== 0) return timeCompare;
  return left.intentId.localeCompare(right.intentId);
}

function unionProjectionPaths(
  records: readonly OperatorToolPlanningProjection[],
  key: 'pathHints' | 'existingPathHints' | 'candidatePathHints',
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const record of records) {
    const paths = record[key];
    if (paths === undefined) continue;
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      ordered.push(path);
    }
  }
  return ordered;
}

function buildProvenanceSummary(records: readonly OperatorToolPlanningProjection[]): string {
  const lines = [
    'Operator tool investigation (read-only; not applied)',
    ...records.map(
      (record) => `- ${record.toolId} (${record.intentId}): ${record.summaryDigest.slice(0, 48)}`,
    ),
  ];
  return lines.join('\n').slice(0, PROVENANCE_SUMMARY_MAX);
}
