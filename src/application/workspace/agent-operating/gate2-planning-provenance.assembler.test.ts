/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { buildInvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import { OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION } from '../agent-loop/agent-loop.types';
import type { BoundedToolEvidenceRecord } from '../agent-loop/agent-loop.types';
import type { Gate2ReviewProjection } from '../gate2-review';
import { buildOperatorToolPlanningContext } from './operator-tool-planning-context';
import { mergeOperatorToolPlanningWithHandoff } from './operator-tool-planning-merge';
import { isOperatorToolPlanningMergeInput } from './operator-tool-planning-prepare-input';
import {
  assembleGate2PlanningProvenance,
  extractCorrectionPlanningPathHints,
} from './gate2-planning-provenance.assembler';
import { GATE2_PLANNING_PROVENANCE_LIMITS } from './gate2-planning-provenance.types';
import {
  ITERATION_FEEDBACK_KIND,
  ITERATION_FEEDBACK_SCHEMA_VERSION,
} from '../iteration-feedback.types';

function handoff(
  overrides: {
    readonly pathHints?: readonly string[];
    readonly existingPathHints?: readonly string[];
    readonly candidatePathHints?: readonly string[];
  } = {},
) {
  return buildInvestigationHandoffFeedback({
    sourceInvestigationId: 'inv-1',
    priorRequestSummary: 'Fix integration output.',
    investigationSummary: 'P0 investigation summary.',
    sourcePaths: ['src/p0.ts'],
    requestText: 'integration',
    queries: ['integration'],
    evidence: [],
    searchMatches: [],
    hypotheses: [],
    affectedAreas: [],
    ...overrides,
  });
}

function projection(overrides: {
  readonly intentId: string;
  readonly recordedAt: string;
  readonly pathHints?: readonly string[];
  readonly existingPathHints?: readonly string[];
  readonly candidatePathHints?: readonly string[];
}) {
  return {
    projectionSchemaVersion: OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
    sourceRunId: 'run-1',
    toolId: 'search_repository',
    intentId: overrides.intentId,
    phase: 'UNDERSTANDING' as const,
    status: 'SUCCEEDED' as const,
    recordedAt: overrides.recordedAt,
    provenance: 'OPERATOR_TOOL_TURN' as const,
    summaryDigest: 'digest1234567890123456789012',
    ...(overrides.pathHints === undefined ? {} : { pathHints: overrides.pathHints }),
    ...(overrides.existingPathHints === undefined
      ? {}
      : { existingPathHints: overrides.existingPathHints }),
    ...(overrides.candidatePathHints === undefined
      ? {}
      : { candidatePathHints: overrides.candidatePathHints }),
  };
}

function evidenceRecord(
  planningProjection: ReturnType<typeof projection> | undefined,
): BoundedToolEvidenceRecord {
  return {
    schemaVersion: 2,
    runId: 'run-1',
    projectId: 'builder-ai',
    phase: 'UNDERSTANDING',
    toolId: 'search_repository',
    intentId: planningProjection?.intentId ?? 'intent-1',
    status: 'SUCCEEDED',
    recordedAt: planningProjection?.recordedAt ?? '2026-08-28T12:00:00.000Z',
    summaryDigest: 'digest1234567890123456789012',
    ...(planningProjection === undefined ? {} : { planningProjection }),
  };
}

function gate2(logicalPaths: readonly string[]): Gate2ReviewProjection {
  return {
    schemaVersion: 1,
    operationDiffs: logicalPaths.map((logicalPath, index) => ({
      operationId: `op-${index + 1}`,
      kind: 'UPDATE_FILE' as const,
      logicalPath,
      label: 'UPDATE FILE' as const,
      format: 'UNIFIED' as const,
      truncated: false,
      lineCount: 1,
      characterCount: 10,
    })),
    totalCharacterCount: logicalPaths.length * 10,
    truncated: false,
  };
}

const FORBIDDEN_KEYS = [
  'unifiedDiff',
  'fileContents',
  'content',
  'stdout',
  'stderr',
  'changePlan',
  'gate2Review',
  'applyAuthorizationToken',
  'approved',
  'providerResponse',
  'promptPackage',
] as const;

describe('assembleGate2PlanningProvenance', () => {
  it('reports P0-only context and attribution', () => {
    const p0 = {
      ...handoff(),
      pathHints: ['src/p0-only.ts'],
      existingPathHints: ['src/p0-existing.ts'],
    };
    const merged = mergeOperatorToolPlanningWithHandoff({
      handoff: p0,
      operatorContext: undefined,
    });
    const review = assembleGate2PlanningProvenance({
      handoff: p0,
      merged,
      gate2Review: gate2(['src/p0-only.ts']),
    });
    expect(review.hasP0Context).toBe(true);
    expect(review.hasOperatorContext).toBe(false);
    expect(review.p0PathHintCount).toBeGreaterThan(0);
    expect(review.operatorPathHintCount).toBe(0);
    expect(review.p0OnlyPathHints).toContain('src/p0-only.ts');
    expect(review.operatorOnlyPathHints).toEqual([]);
  });

  it('reports operator-only context and attribution', () => {
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-1',
          recordedAt: '2026-08-28T12:01:00.000Z',
          pathHints: ['src/operator-only.ts'],
        }),
      ),
    ]);
    expect(operatorContext).toBeDefined();
    const merged = mergeOperatorToolPlanningWithHandoff({
      handoff: undefined,
      operatorContext,
    });
    const review = assembleGate2PlanningProvenance({
      operatorContext,
      merged,
      gate2Review: gate2(['src/operator-only.ts']),
    });
    expect(review.hasP0Context).toBe(false);
    expect(review.hasOperatorContext).toBe(true);
    expect(review.operatorPathHintCount).toBeGreaterThan(0);
    expect(review.operatorOnlyPathHints).toContain('src/operator-only.ts');
    expect(review.p0OnlyPathHints).toEqual([]);
  });

  it('attributes shared paths to P0 with operator-only for unique operator paths', () => {
    const p0 = {
      ...handoff(),
      pathHints: ['src/shared.ts', 'src/p0.ts'],
      candidatePathHints: ['src/p0-candidate.ts'],
    };
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-1',
          recordedAt: '2026-08-28T12:01:00.000Z',
          pathHints: ['src/shared.ts', 'src/operator.ts'],
        }),
      ),
    ]);
    const merged = mergeOperatorToolPlanningWithHandoff({ handoff: p0, operatorContext });
    expect(isOperatorToolPlanningMergeInput(merged)).toBe(true);
    const review = assembleGate2PlanningProvenance({
      handoff: p0,
      operatorContext,
      merged,
      gate2Review: gate2(['src/shared.ts', 'src/p0.ts']),
    });
    expect(review.hasP0Context).toBe(true);
    expect(review.hasOperatorContext).toBe(true);
    expect(review.p0OnlyPathHints).toContain('src/p0.ts');
    expect(review.p0OnlyPathHints).not.toContain('src/shared.ts');
    expect(review.operatorOnlyPathHints).toContain('src/operator.ts');
    expect(review.operatorOnlyPathHints).not.toContain('src/shared.ts');
    expect(review.mergedPathHints.length).toBeGreaterThan(0);
  });

  it('deduplicates paths deterministically', () => {
    const p0 = {
      ...handoff(),
      pathHints: ['src/dup.ts', 'src/dup.ts'],
      existingPathHints: ['src/dup.ts'],
    };
    const review = assembleGate2PlanningProvenance({
      handoff: p0,
      merged: p0,
      gate2Review: gate2(['src/dup.ts']),
    });
    expect(review.p0PathHintCount).toBe(1);
    expect(review.p0OnlyPathHints).toEqual(['src/dup.ts']);
  });

  it('computes overlap and unmatched merged hints against planned logical paths', () => {
    const p0 = {
      ...handoff(),
      pathHints: ['src/matched.ts', 'src/unmatched.ts'],
    };
    const review = assembleGate2PlanningProvenance({
      handoff: p0,
      merged: p0,
      gate2Review: gate2(['src/matched.ts', 'src/planned-only.ts']),
    });
    expect(review.plannedPathOverlapCount).toBe(1);
    expect(review.matchedPlannedPaths).toEqual(['src/matched.ts']);
    expect(review.unmatchedMergedHintCount).toBe(1);
    expect(review.unmatchedMergedPathHints).toEqual(['src/unmatched.ts']);
    expect(review.plannedOperationCount).toBe(2);
  });

  it('truncates display lists while retaining full counts', () => {
    const paths = Array.from(
      { length: GATE2_PLANNING_PROVENANCE_LIMITS.MAX_PATH_HINTS + 3 },
      (_, index) => `src/file-${index}.ts`,
    );
    const p0 = { ...handoff(), pathHints: paths };
    const review = assembleGate2PlanningProvenance({
      handoff: p0,
      merged: p0,
      gate2Review: gate2([]),
    });
    expect(review.p0PathHintCount).toBe(paths.length);
    expect(review.mergedPathHints.length).toBe(GATE2_PLANNING_PROVENANCE_LIMITS.MAX_PATH_HINTS);
    expect(review.truncated).toBe(true);
  });

  it('degrades gracefully when operator projection is missing', () => {
    const p0 = { ...handoff(), pathHints: ['src/p0.ts'] };
    const review = assembleGate2PlanningProvenance({
      handoff: p0,
      operatorContext: undefined,
      merged: p0,
      gate2Review: gate2(['src/p0.ts']),
    });
    expect(review.hasOperatorContext).toBe(false);
    expect(review.operatorPathHintCount).toBe(0);
  });

  it('supports correction-path hints without operator attribution', () => {
    const feedback = {
      schemaVersion: ITERATION_FEEDBACK_SCHEMA_VERSION,
      kind: ITERATION_FEEDBACK_KIND,
      apply: {
        status: 'PARTIALLY_APPLIED' as const,
        createdPaths: ['src/correction.ts'],
        updatedPaths: [],
        deletedPaths: [],
        skippedPaths: [],
        errors: [],
        warnings: [],
      },
    };
    const correctionPathHints = extractCorrectionPlanningPathHints(feedback);
    const review = assembleGate2PlanningProvenance({
      gate2Review: gate2(['src/correction.ts']),
      correctionPathHints,
    });
    expect(review.hasP0Context).toBe(false);
    expect(review.hasOperatorContext).toBe(false);
    expect(review.mergedPathHints).toEqual(['src/correction.ts']);
    expect(review.plannedPathOverlapCount).toBe(1);
  });

  it('does not include forbidden fields in serialized output', () => {
    const p0 = { ...handoff(), pathHints: ['src/a.ts'] };
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-1',
          recordedAt: '2026-08-28T12:01:00.000Z',
          pathHints: ['src/b.ts'],
        }),
      ),
    ]);
    const merged = mergeOperatorToolPlanningWithHandoff({ handoff: p0, operatorContext });
    const review = assembleGate2PlanningProvenance({
      handoff: p0,
      operatorContext,
      merged,
      gate2Review: gate2(['src/a.ts']),
    });
    const serialized = JSON.stringify(review);
    for (const key of FORBIDDEN_KEYS) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });
});
