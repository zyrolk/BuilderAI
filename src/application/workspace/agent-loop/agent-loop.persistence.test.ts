/**
 * @vitest-environment node
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AgentLoopEvidencePersistence,
  parsePersistedAgentLoopState,
} from './agent-loop.persistence';
import {
  AGENT_LOOP_LEGACY_SCHEMA_VERSION,
  AGENT_LOOP_SCHEMA_VERSION,
  OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
} from './agent-loop.types';

const BUDGET = {
  toolCalls: 0,
  providerTurns: 0,
  b4VerificationCalls: 0,
  browserObservationCalls: 0,
  startedAtMs: 1,
  identicalRepeatCounts: {},
  completedIntentIds: [],
} as const;

describe('agent-loop persistence v1/v2 compatibility', () => {
  it('hydrates v1 evidence without planningProjection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'builderai-loop-v1-'));
    const runId = 'run-v1';
    try {
      const dir = path.join(root, 'workflows', 'builder-ai', 'agent-runs', runId);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'tool-loop-evidence.json'),
        JSON.stringify({
          schemaVersion: AGENT_LOOP_LEGACY_SCHEMA_VERSION,
          runId,
          projectId: 'builder-ai',
          budget: BUDGET,
          evidence: [
            {
              schemaVersion: AGENT_LOOP_LEGACY_SCHEMA_VERSION,
              runId,
              projectId: 'builder-ai',
              phase: 'UNDERSTANDING',
              toolId: 'search_repository',
              intentId: 'i-v1',
              status: 'SUCCEEDED',
              recordedAt: '2026-08-28T12:00:00.000Z',
              summaryDigest: 'digest1234567890123456789012',
            },
          ],
          updatedAt: '2026-08-28T12:00:00.000Z',
        }),
        'utf8',
      );

      const persistence = new AgentLoopEvidencePersistence(root, 'builder-ai');
      const loaded = await persistence.load(runId);
      expect(loaded?.schemaVersion).toBe(AGENT_LOOP_LEGACY_SCHEMA_VERSION);
      expect(loaded?.evidence[0]?.planningProjection).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hydrates v2 evidence with projection and drops malformed projection', async () => {
    const runId = 'run-v2';
    const validProjection = {
      projectionSchemaVersion: OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION,
      sourceRunId: runId,
      toolId: 'search_repository',
      intentId: 'i-valid',
      phase: 'UNDERSTANDING',
      status: 'SUCCEEDED',
      recordedAt: '2026-08-28T12:00:00.000Z',
      provenance: 'OPERATOR_TOOL_TURN',
      summaryDigest: 'digest1234567890123456789012',
      pathHints: ['src/a.ts'],
    };
    const parsed = parsePersistedAgentLoopState(
      {
        schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
        runId,
        projectId: 'builder-ai',
        budget: BUDGET,
        evidence: [
          {
            schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
            runId,
            projectId: 'builder-ai',
            phase: 'UNDERSTANDING',
            toolId: 'search_repository',
            intentId: 'i-valid',
            status: 'SUCCEEDED',
            recordedAt: '2026-08-28T12:00:00.000Z',
            summaryDigest: 'digest1234567890123456789012',
            planningProjection: validProjection,
          },
          {
            schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
            runId,
            projectId: 'builder-ai',
            phase: 'UNDERSTANDING',
            toolId: 'search_repository',
            intentId: 'i-bad',
            status: 'SUCCEEDED',
            recordedAt: '2026-08-28T12:01:00.000Z',
            summaryDigest: 'digest1234567890123456789012',
            planningProjection: { stdout: 'leak', projectionSchemaVersion: 1 },
          },
          {
            schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
            runId,
            projectId: 'builder-ai',
            phase: 'UNDERSTANDING',
            toolId: 'search_repository',
            intentId: 'i-wrong-version',
            status: 'SUCCEEDED',
            recordedAt: '2026-08-28T12:02:00.000Z',
            summaryDigest: 'digest1234567890123456789012',
            planningProjection: { projectionSchemaVersion: 99, provenance: 'OPERATOR_TOOL_TURN' },
          },
        ],
        updatedAt: '2026-08-28T12:00:00.000Z',
      },
      'builder-ai',
      runId,
    );
    expect(parsed.evidence[0]?.planningProjection?.pathHints).toEqual(['src/a.ts']);
    expect(parsed.evidence[1]?.planningProjection).toBeUndefined();
    expect(parsed.evidence[2]?.planningProjection).toBeUndefined();
  });

  it('rejects forbidden persisted keys', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'builderai-loop-forbidden-'));
    try {
      const persistence = new AgentLoopEvidencePersistence(root, 'builder-ai');
      await expect(
        persistence.save({
          schemaVersion: AGENT_LOOP_SCHEMA_VERSION,
          runId: 'run-forbidden',
          projectId: 'builder-ai',
          budget: BUDGET,
          evidence: [],
          updatedAt: '2026-08-28T12:00:00.000Z',
          changePlan: {},
        } as never),
      ).rejects.toMatchObject({ code: 'FORBIDDEN_PERSISTED_KEY' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
