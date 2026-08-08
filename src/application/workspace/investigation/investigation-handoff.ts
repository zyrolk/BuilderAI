import { ITERATION_FEEDBACK_SCHEMA_VERSION } from '../iteration-feedback.types';
import { ITERATION_FEEDBACK_LIMITS } from '../iteration-feedback.types';
import {
  collectHandoffPathCandidates,
  selectTopHandoffPaths,
  buildInvestigationRankingContext,
} from './investigation-path-ranking';
import type {
  InvestigationEvidence,
  InvestigationHypothesis,
  RepositorySearchMatch,
} from './investigation.types';

export const INVESTIGATION_HANDOFF_KIND = 'INVESTIGATION_HANDOFF' as const;

export interface InvestigationHandoffFeedback {
  readonly schemaVersion: typeof ITERATION_FEEDBACK_SCHEMA_VERSION;
  readonly kind: typeof INVESTIGATION_HANDOFF_KIND;
  readonly sourceInvestigationId: string;
  readonly priorRequestSummary: string;
  readonly investigationSummary: string;
  readonly suggestedFixScope?: string;
  readonly pathHints: readonly string[];
  readonly existingPathHints: readonly string[];
  readonly candidatePathHints: readonly string[];
}

export function buildInvestigationHandoffFeedback(input: {
  readonly sourceInvestigationId: string;
  readonly priorRequestSummary: string;
  readonly investigationSummary: string;
  readonly suggestedFixScope?: string;
  readonly sourcePaths: readonly string[];
  readonly requestText: string;
  readonly queries: readonly string[];
  readonly evidence: readonly InvestigationEvidence[];
  readonly searchMatches: readonly RepositorySearchMatch[];
  readonly hypotheses: readonly InvestigationHypothesis[];
  readonly affectedAreas: readonly string[];
  readonly likelyRootCause?: string;
}): InvestigationHandoffFeedback {
  const rankingContext = buildInvestigationRankingContext({
    requestText: input.requestText,
    queries: input.queries,
  });
  const candidates = collectHandoffPathCandidates({
    sourcePaths: input.sourcePaths,
    evidence: input.evidence,
    searchMatches: input.searchMatches,
    hypotheses: input.hypotheses,
    affectedAreas: input.affectedAreas,
    ...(input.likelyRootCause === undefined ? {} : { likelyRootCause: input.likelyRootCause }),
    ...(input.suggestedFixScope === undefined
      ? {}
      : { suggestedFixScope: input.suggestedFixScope }),
    context: rankingContext,
  });
  const { pathHints, existingPathHints, candidatePathHints } = selectTopHandoffPaths(
    candidates,
    ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS,
  );

  return {
    schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
    kind: INVESTIGATION_HANDOFF_KIND,
    sourceInvestigationId: input.sourceInvestigationId,
    priorRequestSummary: input.priorRequestSummary.slice(0, 500),
    investigationSummary: input.investigationSummary.slice(0, 800),
    ...(input.suggestedFixScope === undefined
      ? {}
      : { suggestedFixScope: input.suggestedFixScope.slice(0, 500) }),
    pathHints,
    existingPathHints,
    candidatePathHints,
  };
}

export function buildInvestigationPrepareIntentBlock(
  handoff: InvestigationHandoffFeedback,
): string {
  const lines = [
    'Investigation handoff constraints:',
    '- This prepare request follows a read-only investigation. Do not assume broader authorization than the cited evidence supports.',
    '- Prefer the smallest safe mutation that addresses the investigation findings.',
  ];

  if (handoff.existingPathHints.length > 0) {
    lines.push(
      '- These repository paths already exist and should be changed with UPDATE_FILE when modified:',
      ...handoff.existingPathHints.map((path) => `  - ${path}`),
      '- Do not use CREATE_FILE for any path listed above.',
    );
  }

  if (handoff.candidatePathHints.length > 0) {
    lines.push(
      '- These paths were suggested by investigation but are not present in the current source index. Use CREATE_FILE only if a genuinely new file is required:',
      ...handoff.candidatePathHints.map((path) => `  - ${path}`),
    );
  }

  lines.push(
    '- If investigation evidence is insufficient, return no filesystem operations rather than fabricating speculative changes.',
    '- An inconclusive investigation does not authorize broad refactors or unrelated file edits.',
  );

  return lines.join('\n');
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
    Array.isArray(Reflect.get(value, 'pathHints')) &&
    Array.isArray(Reflect.get(value, 'existingPathHints')) &&
    Array.isArray(Reflect.get(value, 'candidatePathHints'))
  );
}

export function extractInvestigationHandoffPathHints(
  feedback: InvestigationHandoffFeedback,
): readonly string[] {
  return feedback.pathHints;
}
