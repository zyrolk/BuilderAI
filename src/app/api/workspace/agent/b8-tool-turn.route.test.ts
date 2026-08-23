/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as toolTurnPost } from './run/[runId]/tool-turn/route';
import { assertNoToolTurnAuthorityFields, readToolTurnIntents } from './agent-route-helpers';
import { WorkspaceRuntimeError } from '../../../../application/workspace';

const mockGetReady = vi.fn();
const mockSecurity = vi.fn();

vi.mock('../../../../infrastructure/workspace/local-feature-workflow-runtime', () => ({
  getReadyLocalAgentOperatingService: () => mockGetReady(),
  getLocalWorkspaceSecurityConfiguration: () => mockSecurity(),
}));

vi.mock('../../../../infrastructure/workspace', async () => {
  const actual = await vi.importActual('../../../../infrastructure/workspace');
  return {
    ...(actual as object),
    assertTrustedLocalRequest: () => undefined,
    assertAuthorizedWorkspaceRequest: () => undefined,
    readBoundedJson: async (request: Request) => request.json(),
    readWorkspaceRequestSecurityEvidence: (_request: Request, body: unknown) => ({
      operatorApproved: false,
      browserObservationApproved:
        typeof body === 'object' &&
        body !== null &&
        Reflect.get(body, 'browserObservationApproved') === true,
    }),
  };
});

describe('B8 tool-turn HTTP route', () => {
  beforeEach(() => {
    mockGetReady.mockReset();
    mockSecurity.mockReset();
    mockSecurity.mockReturnValue({
      profile: 'TRUSTED_LOCAL',
      projectId: 'builder-ai',
      principalId: 'local-operator',
    });
  });

  it('rejects forged authority fields on tool-turn helpers', () => {
    expect(() => assertNoToolTurnAuthorityFields({ approved: true })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() => assertNoToolTurnAuthorityFields({ applyAuthorizationToken: 'x' })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(
      readToolTurnIntents({ intent: { toolId: 'search_repository', intentId: 'i1' } }),
    ).toEqual([{ toolId: 'search_repository', intentId: 'i1' }]);
  });

  it('executes run-bound tool turn and rejects cross-project', async () => {
    const executeToolTurn = vi.fn(async () => ({
      run: {
        runId: 'run-1',
        projectId: 'builder-ai',
        goal: 'g',
        phase: 'UNDERSTANDING',
        status: 'RUNNING',
        createdAt: 't',
        updatedAt: 't',
        references: {},
      },
      turn: {
        intentId: 'i1',
        toolId: 'search_repository',
        status: 'SUCCEEDED',
        replayed: false,
        budget: {
          toolCalls: 1,
          providerTurns: 0,
          b4VerificationCalls: 0,
          browserObservationCalls: 0,
          startedAtMs: 0,
          identicalRepeatCounts: {},
          completedIntentIds: ['i1'],
        },
        evidence: {
          schemaVersion: 1,
          runId: 'run-1',
          projectId: 'builder-ai',
          phase: 'UNDERSTANDING',
          toolId: 'search_repository',
          intentId: 'i1',
          status: 'SUCCEEDED',
          recordedAt: 't',
          summaryDigest: 'abc',
        },
      },
      evidence: [],
      budget: {
        toolCalls: 1,
        providerTurns: 0,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
        startedAtMs: 0,
        identicalRepeatCounts: {},
        completedIntentIds: ['i1'],
      },
    }));
    mockGetReady.mockResolvedValue({
      getRun: async () => ({
        runId: 'run-1',
        projectId: 'builder-ai',
        goal: 'g',
        phase: 'UNDERSTANDING',
        status: 'RUNNING',
        createdAt: 't',
        updatedAt: 't',
        references: {},
      }),
      executeToolTurn,
    });

    const ok = await toolTurnPost(
      new Request('http://localhost/api/workspace/agent/run/run-1/tool-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: { toolId: 'search_repository', intentId: 'i1', arguments: { query: 'a' } },
        }),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(ok.status).toBe(200);
    expect(executeToolTurn).toHaveBeenCalled();

    mockGetReady.mockResolvedValue({
      getRun: async () => ({
        runId: 'run-1',
        projectId: 'other-project',
        goal: 'g',
        phase: 'UNDERSTANDING',
        status: 'RUNNING',
        createdAt: 't',
        updatedAt: 't',
        references: {},
      }),
      executeToolTurn,
    });
    const denied = await toolTurnPost(
      new Request('http://localhost/api/workspace/agent/run/run-1/tool-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          intent: { toolId: 'search_repository', intentId: 'i2', arguments: { query: 'a' } },
        }),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(denied.status).toBe(404);
  });

  it('rejects client-supplied approved / applyAuthorizationToken', async () => {
    mockGetReady.mockResolvedValue({
      getRun: async () => ({
        runId: 'run-1',
        projectId: 'builder-ai',
        goal: 'g',
        phase: 'UNDERSTANDING',
        status: 'RUNNING',
        createdAt: 't',
        updatedAt: 't',
        references: {},
      }),
      executeToolTurn: vi.fn(),
    });
    const response = await toolTurnPost(
      new Request('http://localhost/api/workspace/agent/run/run-1/tool-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          approved: true,
          intent: { toolId: 'search_repository', intentId: 'i1', arguments: { query: 'a' } },
        }),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(400);
  });

  it('accepts intents[] provider turns and browserObservationApproved', async () => {
    const executeToolTurn = vi.fn(async () => ({
      run: {
        runId: 'run-1',
        projectId: 'builder-ai',
        goal: 'g',
        phase: 'VERIFYING',
        status: 'RUNNING',
        createdAt: 't',
        updatedAt: 't',
        references: {},
      },
      turn: {
        turnIndex: 0,
        stopped: false,
        results: [
          {
            intentId: 'i1',
            toolId: 'inspect_browser_verification_catalog',
            status: 'SUCCEEDED',
            replayed: false,
          },
        ],
        budget: {
          toolCalls: 1,
          providerTurns: 1,
          b4VerificationCalls: 0,
          browserObservationCalls: 0,
          startedAtMs: 0,
          identicalRepeatCounts: {},
          completedIntentIds: ['i1'],
        },
      },
      evidence: [
        {
          schemaVersion: 1,
          runId: 'run-1',
          projectId: 'builder-ai',
          phase: 'VERIFYING',
          toolId: 'inspect_browser_verification_catalog',
          intentId: 'i1',
          status: 'SUCCEEDED',
          recordedAt: 't',
          summaryDigest: 'abc',
        },
      ],
      budget: {
        toolCalls: 1,
        providerTurns: 1,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
        startedAtMs: 0,
        identicalRepeatCounts: {},
        completedIntentIds: ['i1'],
      },
    }));
    mockGetReady.mockResolvedValue({
      getRun: async () => ({
        runId: 'run-1',
        projectId: 'builder-ai',
        goal: 'g',
        phase: 'VERIFYING',
        status: 'RUNNING',
        createdAt: 't',
        updatedAt: 't',
        references: {},
      }),
      executeToolTurn,
    });
    const response = await toolTurnPost(
      new Request('http://localhost/api/workspace/agent/run/run-1/tool-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          browserObservationApproved: true,
          intents: [
            {
              toolId: 'inspect_browser_verification_catalog',
              intentId: 'i1',
              arguments: {},
            },
          ],
        }),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      turn: { kind: string; results: unknown[] };
      evidence: unknown[];
    };
    expect(body.turn.kind).toBe('providerTurn');
    expect(body.evidence).toHaveLength(1);
    expect(executeToolTurn).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        securityEvidence: expect.objectContaining({
          browserObservationApproved: true,
          operatorApproved: false,
        }),
      }),
    );
  });
});
