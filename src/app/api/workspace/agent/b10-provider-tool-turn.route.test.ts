/**
 * @vitest-environment node
 *
 * P1-B B10 HTTP — provider-tool-turn route (ADR-046).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as providerToolTurnPost } from './run/[runId]/provider-tool-turn/route';
import { assertNoProviderToolTurnAuthorityFields } from './agent-route-helpers';
import { WorkspaceRuntimeError } from '../../../../application/workspace';
import {
  buildProviderAssistedTurnDigest,
  rejectionFromBatchError,
} from '../../../../application/workspace/agent-operating/provider-assisted-turn-rejection';
import { ProviderIntentBatchRejectedError } from '../../../../application/workspace/agent-operating/provider-structured-intent-emission.service';

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

describe('B10 provider-tool-turn HTTP route', () => {
  beforeEach(() => {
    mockGetReady.mockReset();
    mockSecurity.mockReset();
    mockSecurity.mockReturnValue({
      profile: 'TRUSTED_LOCAL',
      projectId: 'builder-ai',
      principalId: 'local-operator',
    });
  });

  it('rejects client-supplied intents and authority fields', () => {
    expect(() => assertNoProviderToolTurnAuthorityFields({ intent: { toolId: 'x' } })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() => assertNoProviderToolTurnAuthorityFields({ intents: [] })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() => assertNoProviderToolTurnAuthorityFields({ approved: true })).toThrow(
      WorkspaceRuntimeError,
    );
    expect(() =>
      assertNoProviderToolTurnAuthorityFields({ applyAuthorizationToken: 'tok' }),
    ).toThrow(WorkspaceRuntimeError);
  });

  it('calls executeProviderAssistedToolTurn without client intents', async () => {
    const executeProviderAssistedToolTurn = vi.fn(async () => ({
      run: {
        schemaVersion: 1,
        runId: 'run-1',
        projectId: 'builder-ai',
        goal: 'g',
        phase: 'UNDERSTANDING',
        status: 'RUNNING',
        createdAt: '2026-08-23T10:00:00.000Z',
        updatedAt: '2026-08-23T10:00:00.000Z',
        references: {},
      },
      budget: {
        toolCalls: 1,
        providerTurns: 1,
        b4VerificationCalls: 0,
        browserObservationCalls: 0,
        startedAtMs: 0,
        identicalRepeatCounts: {},
        completedIntentIds: ['psi-1'],
      },
      evidence: [
        {
          schemaVersion: 1,
          toolId: 'search_repository',
          intentId: 'psi-1',
          phase: 'UNDERSTANDING',
          status: 'SUCCEEDED',
          recordedAt: '2026-08-23T10:00:00.000Z',
          summaryDigest: 'abcd',
        },
      ],
      turn: {
        intentId: 'psi-1',
        toolId: 'search_repository',
        status: 'SUCCEEDED',
        replayed: false,
      },
      providerAssisted: {
        source: 'provider-structured-intent',
        toolCalling: false,
        proposedCount: 1,
        acceptedCount: 1,
        rejectedCount: 0,
        rejections: [],
      },
    }));
    mockGetReady.mockResolvedValue({
      getRun: vi.fn(async () => ({ projectId: 'builder-ai' })),
      executeProviderAssistedToolTurn,
    });

    const response = await providerToolTurnPost(
      new Request('http://localhost/api/workspace/agent/run/run-1/provider-tool-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ browserObservationApproved: true }),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      emission: {
        toolCalling: boolean;
        source: string;
        proposedCount: number;
        acceptedCount: number;
        rejectedCount: number;
      };
    };
    expect(payload.emission).toEqual({
      source: 'provider-structured-intent',
      toolCalling: false,
      proposedCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      rejections: [],
    });
    expect(executeProviderAssistedToolTurn).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        securityEvidence: expect.objectContaining({
          operatorApproved: false,
          browserObservationApproved: true,
        }),
      }),
    );
    expect(executeProviderAssistedToolTurn).toHaveBeenCalledTimes(1);
    expect(executeProviderAssistedToolTurn.mock.calls[0]).toEqual([
      'run-1',
      expect.not.objectContaining({ intents: expect.anything(), intent: expect.anything() }),
    ]);
  });

  it('rejects cross-project runs', async () => {
    mockGetReady.mockResolvedValue({
      getRun: vi.fn(async () => ({ projectId: 'other-project' })),
      executeProviderAssistedToolTurn: vi.fn(),
    });
    const response = await providerToolTurnPost(
      new Request('http://localhost/api/workspace/agent/run/run-x/provider-tool-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: 'run-x' }) },
    );
    expect(response.status).toBe(404);
  });

  it('returns bounded providerAssisted digest on emission rejection', async () => {
    const rejection = rejectionFromBatchError('EMPTY_INTENTS', 'intents[] must not be empty.');
    const digest = buildProviderAssistedTurnDigest({
      proposedCount: 0,
      acceptedCount: 0,
      rejections: [rejection],
    });
    mockGetReady.mockResolvedValue({
      getRun: vi.fn(async () => ({ projectId: 'builder-ai' })),
      executeProviderAssistedToolTurn: vi.fn(async () => {
        throw new ProviderIntentBatchRejectedError(rejection.message, digest);
      }),
    });
    const response = await providerToolTurnPost(
      new Request('http://localhost/api/workspace/agent/run/run-1/provider-tool-turn', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );
    expect(response.status).toBe(400);
    const payload = (await response.json()) as {
      providerAssisted?: { rejectedCount: number; rejections: readonly { code: string }[] };
    };
    expect(payload.providerAssisted?.rejectedCount).toBe(1);
    expect(payload.providerAssisted?.rejections[0]?.code).toBe('EMPTY_INTENTS');
  });
});
