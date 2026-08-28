/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { buildInvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import { OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION } from '../agent-loop/agent-loop.types';
import { buildOperatorToolPlanningContext } from './operator-tool-planning-context';
import { mergeOperatorToolPlanningWithHandoff } from './operator-tool-planning-merge';
import { isOperatorToolPlanningMergeInput } from './operator-tool-planning-prepare-input';
import type { BoundedToolEvidenceRecord } from '../agent-loop/agent-loop.types';

function handoff() {
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

describe('operator-tool-planning merge', () => {
  it('returns undefined when neither P0 nor operator context exists', () => {
    expect(
      mergeOperatorToolPlanningWithHandoff({ handoff: undefined, operatorContext: undefined }),
    ).toBeUndefined();
  });

  it('returns P0 handoff unchanged when no operator context', () => {
    const p0 = handoff();
    expect(mergeOperatorToolPlanningWithHandoff({ handoff: p0, operatorContext: undefined })).toBe(
      p0,
    );
  });

  it('merges P0 and operator paths with P0 precedence on conflicts', () => {
    const p0 = {
      ...handoff(),
      pathHints: ['src/p0-first.ts', 'src/shared.ts'],
      existingPathHints: ['src/p0-existing.ts'],
      candidatePathHints: ['src/p0-candidate.ts'],
    };
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-1',
          recordedAt: '2026-08-28T12:01:00.000Z',
          pathHints: ['src/operator.ts', 'src/shared.ts'],
          existingPathHints: ['src/shared.ts'],
          candidatePathHints: ['src/op-candidate.ts'],
        }),
      ),
    ]);
    expect(operatorContext).toBeDefined();

    const merged = mergeOperatorToolPlanningWithHandoff({ handoff: p0, operatorContext });
    expect(isOperatorToolPlanningMergeInput(merged)).toBe(true);
    if (!isOperatorToolPlanningMergeInput(merged)) return;

    expect(merged.mergedHandoff.pathHints[0]).toBe('src/p0-first.ts');
    expect(merged.mergedHandoff.pathHints).toContain('src/operator.ts');
    expect(merged.mergedHandoff.existingPathHints).toContain('src/p0-existing.ts');
    expect(merged.mergedHandoff.investigationSummary).toContain('P0 investigation summary.');
    expect(merged.mergedHandoff.investigationSummary).toContain(
      'Operator tool investigation (read-only; not applied)',
    );
  });

  it('orders operator records by recordedAt then intentId', () => {
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'b-intent',
          recordedAt: '2026-08-28T12:02:00.000Z',
          pathHints: ['src/second.ts'],
        }),
      ),
      evidenceRecord(
        projection({
          intentId: 'a-intent',
          recordedAt: '2026-08-28T12:01:00.000Z',
          pathHints: ['src/first.ts'],
        }),
      ),
    ]);
    const merged = mergeOperatorToolPlanningWithHandoff({ handoff: handoff(), operatorContext });
    expect(isOperatorToolPlanningMergeInput(merged)).toBe(true);
    if (!isOperatorToolPlanningMergeInput(merged)) return;
    const p0Length = handoff().pathHints.length;
    expect(merged.mergedHandoff.pathHints[p0Length]).toBe('src/first.ts');
    expect(merged.mergedHandoff.pathHints[p0Length + 1]).toBe('src/second.ts');
  });

  it('truncates operator hints after P0 when over cap', () => {
    const p0Paths = Array.from({ length: 8 }, (_, index) => `src/p0-${index}.ts`);
    const p0 = {
      ...handoff(),
      pathHints: p0Paths,
      existingPathHints: [],
      candidatePathHints: [],
    };
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-overflow',
          recordedAt: '2026-08-28T12:03:00.000Z',
          pathHints: ['src/operator-overflow.ts'],
        }),
      ),
    ]);
    const merged = mergeOperatorToolPlanningWithHandoff({ handoff: p0, operatorContext });
    expect(isOperatorToolPlanningMergeInput(merged)).toBe(true);
    if (!isOperatorToolPlanningMergeInput(merged)) return;
    expect(merged.mergedHandoff.pathHints).toHaveLength(8);
    expect(merged.mergedHandoff.pathHints).not.toContain('src/operator-overflow.ts');
  });

  it('promotes verified candidates to existing at merge time', () => {
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-promote',
          recordedAt: '2026-08-28T12:04:00.000Z',
          candidatePathHints: ['src/integration-output.ts'],
        }),
      ),
    ]);
    const merged = mergeOperatorToolPlanningWithHandoff({
      handoff: handoff(),
      operatorContext,
      existingSourcePaths: ['src/integration-output.ts'],
    });
    expect(isOperatorToolPlanningMergeInput(merged)).toBe(true);
    if (!isOperatorToolPlanningMergeInput(merged)) return;
    expect(merged.mergedHandoff.existingPathHints).toContain('src/integration-output.ts');
    expect(merged.mergedHandoff.candidatePathHints).not.toContain('src/integration-output.ts');
  });

  it('builds operator-only merge input when P0 handoff is absent', () => {
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-only',
          recordedAt: '2026-08-28T12:05:00.000Z',
          pathHints: ['src/operator-only.ts'],
        }),
      ),
    ]);
    const merged = mergeOperatorToolPlanningWithHandoff({
      handoff: undefined,
      operatorContext,
    });
    expect(isOperatorToolPlanningMergeInput(merged)).toBe(true);
    if (!isOperatorToolPlanningMergeInput(merged)) return;
    expect(merged.mergedHandoff.pathHints).toContain('src/operator-only.ts');
  });

  it('appends truncation note when operator evidence was truncated', () => {
    const operatorContext = buildOperatorToolPlanningContext([
      evidenceRecord(
        projection({
          intentId: 'op-trunc',
          recordedAt: '2026-08-28T12:06:00.000Z',
          pathHints: ['src/trunc.ts'],
        }),
      ),
    ]);
    expect(operatorContext?.truncated).toBe(false);
    if (operatorContext === undefined) return;
    const merged = mergeOperatorToolPlanningWithHandoff({
      handoff: handoff(),
      operatorContext: { ...operatorContext, truncated: true },
    });
    expect(isOperatorToolPlanningMergeInput(merged)).toBe(true);
    if (!isOperatorToolPlanningMergeInput(merged)) return;
    expect(merged.mergedHandoff.investigationSummary).toContain(
      'operator path hints truncated to policy cap',
    );
  });
});
