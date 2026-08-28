/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';

import { buildOperatorToolPlanningContext } from './operator-tool-planning-context';
import { OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION } from '../agent-loop/agent-loop.types';
import type { BoundedToolEvidenceRecord } from '../agent-loop/agent-loop.types';

describe('operator-tool-planning-context', () => {
  it('ignores evidence outside UNDERSTANDING and failed turns', () => {
    const context = buildOperatorToolPlanningContext([
      {
        schemaVersion: 2,
        runId: 'run-1',
        projectId: 'builder-ai',
        phase: 'PLANNING',
        toolId: 'search_repository',
        intentId: 'planning-turn',
        status: 'SUCCEEDED',
        recordedAt: '2026-08-28T12:00:00.000Z',
        summaryDigest: 'digest1234567890123456789012',
        planningProjection: {
          projectionSchemaVersion: OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
          sourceRunId: 'run-1',
          toolId: 'search_repository',
          intentId: 'planning-turn',
          phase: 'UNDERSTANDING',
          status: 'SUCCEEDED',
          recordedAt: '2026-08-28T12:00:00.000Z',
          provenance: 'OPERATOR_TOOL_TURN',
          summaryDigest: 'digest1234567890123456789012',
          pathHints: ['src/planning.ts'],
        },
      },
    ] satisfies BoundedToolEvidenceRecord[]);
    expect(context).toBeUndefined();
  });
});
