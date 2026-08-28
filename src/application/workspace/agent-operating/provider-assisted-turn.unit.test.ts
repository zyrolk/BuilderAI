/**
 * @vitest-environment node
 *
 * B10 provider-assisted turn reliability + bounded observability (D+B).
 */
import { describe, expect, it } from 'vitest';

import type { AgentLoopError } from '../agent-loop';
import { AgentRunError } from './agent-run.types';
import {
  buildProviderAssistedTurnDigest,
  rejectionFromAgentLoopError,
  rejectionFromBatchError,
} from './provider-assisted-turn-rejection';
import {
  parseProviderIntentBatch,
  parseProviderIntentBatchWithDiagnostics,
  ProviderIntentBatchRejectedError,
} from './provider-structured-intent-emission.service';

export const VALID_PROVIDER_BATCH = {
  schemaVersion: 1,
  intents: [{ toolId: 'search_repository', intentId: 'psi-1', arguments: { query: 'health' } }],
} as const;

export const EMPTY_PROVIDER_BATCH = {
  schemaVersion: 1,
  intents: [],
} as const;

export const AUTHORITY_PROVIDER_BATCH = {
  schemaVersion: 1,
  approved: true,
  intents: [{ toolId: 'search_repository', intentId: 'psi-1', arguments: {} }],
} as const;

export const FORBIDDEN_TOOL_BATCH = {
  schemaVersion: 1,
  intents: [{ toolId: 'file_apply', intentId: 'psi-1', arguments: {} }],
} as const;

export const MIXED_PROVIDER_BATCH = {
  schemaVersion: 1,
  intents: [
    { toolId: 'search_repository', intentId: 'psi-1', arguments: { query: 'ok' } },
    { toolId: 'mcp_tool', intentId: 'psi-2', arguments: {} },
    {
      browserObservationApproved: true,
      toolId: 'search_repository',
      intentId: 'psi-3',
      arguments: {},
    },
  ],
} as const;

describe('provider-assisted rejection taxonomy', () => {
  it('maps batch-level failures to stable codes and operator actions', () => {
    const rejection = rejectionFromBatchError('EMPTY_INTENTS', 'intents[] must not be empty.');
    expect(rejection.code).toBe('EMPTY_INTENTS');
    expect(rejection.operatorAction).toBe('RETRY_PROVIDER_ASSISTED');
    expect(rejectionFromBatchError('MALFORMED_OUTPUT', 'bad').operatorAction).toBe(
      'RETRY_PROVIDER_ASSISTED',
    );
    expect(rejectionFromBatchError('AUTHORITY_FIELD_FORBIDDEN', 'bad').operatorAction).toBe(
      'USE_OPERATOR_PRESET',
    );
    expect(rejectionFromBatchError('FORBIDDEN_TOOL', 'bad').operatorAction).toBe('CORRECT_PHASE');
    expect(rejectionFromBatchError('INVALID_INTENT_SCHEMA', 'bad').operatorAction).toBe(
      'REVIEW_GOAL',
    );
  });

  it('maps AgentLoop forbidden browser tools to ENABLE_BROWSER_APPROVAL', () => {
    const rejection = rejectionFromAgentLoopError(
      {
        code: 'FORBIDDEN_TOOL',
        message: 'Tool "observe_localhost_page" is not available.',
      } as AgentLoopError,
      { intentIndex: 0, toolId: 'observe_localhost_page', intentId: 'psi-b' },
    );
    expect(rejection.code).toBe('FORBIDDEN_TOOL');
    expect(rejection.operatorAction).toBe('ENABLE_BROWSER_APPROVAL');
  });

  it('maps non-browser forbidden tools to CORRECT_PHASE', () => {
    const rejection = rejectionFromAgentLoopError(
      { code: 'FORBIDDEN_TOOL', message: 'Tool "run_shell" is not available.' } as AgentLoopError,
      { intentIndex: 0, toolId: 'run_shell', intentId: 'psi-s' },
    );
    expect(rejection.operatorAction).toBe('CORRECT_PHASE');
  });

  it('maps authority and schema failures to stable actions', () => {
    expect(
      rejectionFromAgentLoopError(
        { code: 'AUTHORITY_FIELD_REJECTED', message: 'no authority' } as AgentLoopError,
        { intentIndex: 1 },
      ).operatorAction,
    ).toBe('USE_OPERATOR_PRESET');
    expect(
      rejectionFromAgentLoopError(
        { code: 'INVALID_INTENT_SCHEMA', message: 'bad schema' } as AgentLoopError,
        { intentIndex: 2 },
      ).operatorAction,
    ).toBe('REVIEW_GOAL');
  });
  it('truncates long rejection messages', () => {
    const rejection = rejectionFromBatchError('MALFORMED_OUTPUT', 'x'.repeat(300));
    expect(rejection.message.length).toBeLessThanOrEqual(240);
    expect(rejection.message.endsWith('…')).toBe(true);
  });
});

describe('parseProviderIntentBatchWithDiagnostics', () => {
  it('accepts valid batches with zero rejections', () => {
    const result = parseProviderIntentBatchWithDiagnostics(VALID_PROVIDER_BATCH);
    expect(result.intents).toHaveLength(1);
    expect(result.digest).toEqual(
      buildProviderAssistedTurnDigest({
        proposedCount: 1,
        acceptedCount: 1,
        rejections: [],
      }),
    );
  });

  it('accepts partial batches and records per-intent rejections', () => {
    const result = parseProviderIntentBatchWithDiagnostics(MIXED_PROVIDER_BATCH);
    expect(result.intents).toHaveLength(1);
    expect(result.digest.proposedCount).toBe(3);
    expect(result.digest.acceptedCount).toBe(1);
    expect(result.digest.rejectedCount).toBe(2);
    expect(result.digest.rejections.map((entry) => entry.code)).toEqual([
      'FORBIDDEN_TOOL',
      'AUTHORITY_FIELD_FORBIDDEN',
    ]);
  });

  it('throws ProviderIntentBatchRejectedError with digest for empty batches', () => {
    expect(() => parseProviderIntentBatchWithDiagnostics(EMPTY_PROVIDER_BATCH)).toThrow(
      ProviderIntentBatchRejectedError,
    );
    try {
      parseProviderIntentBatchWithDiagnostics(EMPTY_PROVIDER_BATCH);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ProviderIntentBatchRejectedError);
      const rejected = error as ProviderIntentBatchRejectedError;
      expect(rejected.digest.rejectedCount).toBeGreaterThan(0);
      expect(rejected.digest.proposedCount).toBe(0);
    }
  });

  it('throws ProviderIntentBatchRejectedError when every intent is rejected', () => {
    expect(() => parseProviderIntentBatchWithDiagnostics(FORBIDDEN_TOOL_BATCH)).toThrow(
      ProviderIntentBatchRejectedError,
    );
  });

  it('keeps legacy parseProviderIntentBatch throwing AgentRunError', () => {
    expect(() => parseProviderIntentBatch(AUTHORITY_PROVIDER_BATCH)).toThrow(AgentRunError);
    expect(() => parseProviderIntentBatch(EMPTY_PROVIDER_BATCH)).toThrow(AgentRunError);
  });

  it('rejects malformed, missing, and oversized batches with digests', () => {
    expect(() => parseProviderIntentBatchWithDiagnostics(null)).toThrow(
      ProviderIntentBatchRejectedError,
    );
    expect(() =>
      parseProviderIntentBatchWithDiagnostics({ schemaVersion: 1, intents: 'bad' }),
    ).toThrow(ProviderIntentBatchRejectedError);
    expect(() =>
      parseProviderIntentBatchWithDiagnostics({
        schemaVersion: 1,
        approved: true,
        intents: [{ toolId: 'search_repository', intentId: 'x', arguments: {} }],
      }),
    ).toThrow(ProviderIntentBatchRejectedError);
    expect(() =>
      parseProviderIntentBatchWithDiagnostics({
        schemaVersion: 1,
        intents: Array.from({ length: 7 }, (_, index) => ({
          toolId: 'search_repository',
          intentId: `psi-${index}`,
          arguments: {},
        })),
      }),
    ).toThrow(ProviderIntentBatchRejectedError);
  });
});
