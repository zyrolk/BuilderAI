/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import {
  assertNoForbiddenProjectionKeys,
  extractOperatorToolPlanningProjection,
  validateProjectionForPersistence,
} from './operator-tool-planning-projection';
import { OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION } from './agent-loop.types';

const BASE_INPUT = {
  runId: 'run-proj-1',
  toolId: 'search_repository' as const,
  intentId: 'intent-1',
  phase: 'UNDERSTANDING' as const,
  status: 'SUCCEEDED' as const,
  recordedAt: '2026-08-28T12:00:00.000Z',
  summaryDigest: 'abc123digest456789012345678',
};

describe('operator-tool-planning-projection', () => {
  it('extracts bounded paths from search_repository structured output', () => {
    const projection = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      structured: {
        matchCount: 2,
        truncated: false,
        matches: [
          { logicalPath: 'src/a.ts', lineNumber: 1 },
          { logicalPath: './src/b.ts', lineNumber: 2 },
        ],
      },
    });
    expect(projection).toMatchObject({
      projectionSchemaVersion: OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
      provenance: 'OPERATOR_TOOL_TURN',
      searchHitCount: 2,
      pathHints: ['src/a.ts', 'src/b.ts'],
    });
  });

  it('caps path arrays and normalizes paths', () => {
    const matches = Array.from({ length: 12 }, (_, index) => ({
      logicalPath: `src/file-${index}.ts`,
    }));
    const projection = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      structured: { matchCount: 12, matches },
    });
    expect(projection?.pathHints?.length).toBeLessThanOrEqual(8);
    expect(projection?.pathHints?.every((path) => !path.includes('\\'))).toBe(true);
  });

  it('rejects unsupported tools and non-success statuses', () => {
    expect(
      extractOperatorToolPlanningProjection({
        ...BASE_INPUT,
        toolId: 'run_shell',
        structured: { matchCount: 0, matches: [] },
      }),
    ).toBeUndefined();
    expect(
      extractOperatorToolPlanningProjection({
        ...BASE_INPUT,
        status: 'FAILED',
        structured: { matchCount: 0, matches: [] },
      }),
    ).toBeUndefined();
  });

  it('rejects forbidden structured keys via validation', () => {
    expect(() =>
      assertNoForbiddenProjectionKeys({ stdout: 'leak', pathHints: ['src/a.ts'] }),
    ).toThrow(/stdout/);
    const projection = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      structured: {
        matchCount: 1,
        matches: [{ logicalPath: 'src/a.ts', fileContents: 'secret' }],
      },
    });
    expect(projection?.pathHints).toEqual(['src/a.ts']);
    expect(JSON.stringify(projection)).not.toContain('fileContents');
  });

  it('extracts inspect_readiness and retrieve_relevant_context fields', () => {
    const readiness = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      toolId: 'inspect_readiness',
      structured: { status: 'READY', indexedFileCount: 42 },
    });
    expect(readiness).toMatchObject({
      readinessStatus: 'READY',
      relevantFileCount: 42,
    });

    const context = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      toolId: 'retrieve_relevant_context',
      structured: {
        files: [{ logicalPath: 'src/core.ts' }],
        truncated: true,
      },
    });
    expect(context).toMatchObject({
      pathHints: ['src/core.ts'],
      relevantFileCount: 1,
      truncated: true,
    });
  });

  it('extracts find_related_files, inspect_file_outline, and inspect_imports', () => {
    const related = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      toolId: 'find_related_files',
      structured: {
        anchorPath: 'src/anchor.ts',
        related: [{ logicalPath: 'src/related.ts' }],
        truncated: false,
      },
    });
    expect(related?.existingPathHints).toEqual(['src/anchor.ts']);

    const outline = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      toolId: 'inspect_file_outline',
      structured: {
        logicalPath: 'src/outline.ts',
        entries: [],
        truncated: false,
      },
    });
    expect(outline?.pathHints).toEqual(['src/outline.ts']);

    const imports = extractOperatorToolPlanningProjection({
      ...BASE_INPUT,
      toolId: 'inspect_imports',
      structured: {
        fromPath: 'src/from.ts',
        imports: [
          { specifier: './resolved.ts', relative: true, resolvedPath: 'src/resolved.ts' },
          { specifier: './missing.ts', relative: true, resolvedPath: null },
        ],
        truncated: false,
      },
    });
    expect(imports?.existingPathHints).toContain('src/from.ts');
    expect(imports?.candidatePathHints).toContain('missing.ts');
  });

  it('validateProjectionForPersistence rejects invalid counts and paths', () => {
    const base = {
      projectionSchemaVersion: OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
      sourceRunId: 'run-1',
      toolId: 'search_repository',
      intentId: 'i1',
      phase: 'UNDERSTANDING' as const,
      status: 'SUCCEEDED' as const,
      recordedAt: '2026-08-28T12:00:00.000Z',
      provenance: 'OPERATOR_TOOL_TURN' as const,
      summaryDigest: 'digest1234567890123456789012',
    };
    expect(validateProjectionForPersistence({ ...base, searchHitCount: -1 })).toBe(false);
    expect(validateProjectionForPersistence({ ...base, pathHints: ['../escape.ts'] })).toBe(false);
  });

  it('validateProjectionForPersistence enforces size cap', () => {
    const projection = {
      projectionSchemaVersion: OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
      sourceRunId: 'run-1',
      toolId: 'search_repository',
      intentId: 'i1',
      phase: 'UNDERSTANDING' as const,
      status: 'SUCCEEDED' as const,
      recordedAt: '2026-08-28T12:00:00.000Z',
      provenance: 'OPERATOR_TOOL_TURN' as const,
      summaryDigest: 'digest1234567890123456789012',
      readinessStatus: 'R'.repeat(2_000),
    };
    expect(validateProjectionForPersistence(projection)).toBe(false);
  });
});
