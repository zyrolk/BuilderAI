/**
 * @vitest-environment node
 *
 * P1-B B10 — Provider structured-intent emission (ADR-046).
 */
import { describe, expect, it, vi } from 'vitest';

import { parseProviderStructuredToolIntent } from '../agent-loop';
import type { ProviderExecutionPort } from '../workspace-runtime.types';
import { AgentRunError } from './agent-run.types';
import {
  parseProviderIntentBatch,
  ProviderStructuredIntentEmissionService,
} from './provider-structured-intent-emission.service';

function fakeExecution(data: unknown): ProviderExecutionPort {
  return {
    execute: vi.fn(async () => ({
      providerResponse: {
        schemaVersion: 1,
        providerId: 'test-provider',
        model: 'test-model',
        status: 'SUCCEEDED',
        artifacts: [{ kind: 'STRUCTURED_DATA' as const, data }],
        metadata: { values: {} },
      },
      executionResult: {
        schemaVersion: 1,
        executionId: 'exec',
        status: 'SUCCEEDED',
        diagnostics: [],
        timing: {
          queuedAt: '2026-08-23T10:00:00.000Z',
          startedAt: '2026-08-23T10:00:00.000Z',
          completedAt: '2026-08-23T10:00:00.000Z',
          durationMs: 1,
        },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        artifacts: [],
        errors: [],
        metadata: { values: {} },
      },
    })) as unknown as ProviderExecutionPort['execute'],
  };
}

describe('parseProviderIntentBatch (ADR-046)', () => {
  it('accepts bounded soft intents and rejects authority/binding fields', () => {
    const intents = parseProviderIntentBatch({
      schemaVersion: 1,
      intents: [{ toolId: 'search_repository', intentId: 'psi-1', arguments: { query: 'health' } }],
    });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.toolId).toBe('search_repository');

    expect(() =>
      parseProviderIntentBatch({
        schemaVersion: 1,
        approved: true,
        intents: [{ toolId: 'search_repository', intentId: 'x', arguments: {} }],
      }),
    ).toThrow(AgentRunError);

    expect(() =>
      parseProviderIntentBatch({
        schemaVersion: 1,
        intents: [
          {
            toolId: 'search_repository',
            intentId: 'x',
            browserObservationApproved: true,
            arguments: {},
          },
        ],
      }),
    ).toThrow(/authority/i);

    expect(() =>
      parseProviderIntentBatch({
        schemaVersion: 1,
        intents: [{ toolId: 'file_apply', intentId: 'x', arguments: {} }],
      }),
    ).toThrow(/FileApply|not available|FORBIDDEN/i);

    expect(() =>
      parseProviderIntentBatch({
        schemaVersion: 1,
        intents: [{ toolId: 'mcp_search', intentId: 'x', arguments: {} }],
      }),
    ).toThrow(/not available/i);

    expect(() =>
      parseProviderIntentBatch({
        schemaVersion: 1,
        intents: [{ toolId: 'open_web', intentId: 'x', arguments: {} }],
      }),
    ).toThrow(/not available/i);

    expect(() => parseProviderIntentBatch({ schemaVersion: 1, intents: [] })).toThrow(
      /must not be empty/i,
    );
  });

  it('keeps parseProviderStructuredToolIntent rejecting shell/push/WEB and binding fields', () => {
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'run_shell',
        intentId: 'x',
        arguments: {},
      }),
    ).toThrow(/not available/i);
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'search_repository',
        intentId: 'x',
        projectId: 'evil',
        arguments: {},
      }),
    ).toThrow(/authority/i);
    expect(() =>
      parseProviderStructuredToolIntent({
        toolId: 'search_repository',
        intentId: 'x',
        phase: 'EXECUTING',
        arguments: {},
      }),
    ).toThrow(/authority/i);
  });
});

describe('ProviderStructuredIntentEmissionService', () => {
  it('proposes intents from provider STRUCTURED_DATA without executing tools', async () => {
    const providerExecution = fakeExecution({
      schemaVersion: 1,
      intents: [{ toolId: 'inspect_readiness', intentId: 'psi-ready', arguments: {} }],
    });
    const service = new ProviderStructuredIntentEmissionService({
      providerExecution,
      ids: { generate: () => 'exec-1' },
      clock: { now: () => new Date('2026-08-23T10:00:00.000Z') },
    });
    const intents = await service.proposeIntents({
      run: {
        schemaVersion: 1,
        runId: 'run-1',
        projectId: 'proj-1',
        goal: 'Inspect readiness',
        phase: 'UNDERSTANDING',
        status: 'RUNNING',
        createdAt: '2026-08-23T10:00:00.000Z',
        updatedAt: '2026-08-23T10:00:00.000Z',
        references: {},
      },
    });
    expect(intents).toEqual([
      { toolId: 'inspect_readiness', intentId: 'psi-ready', arguments: {} },
    ]);
    expect(providerExecution.execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed on malformed provider output', async () => {
    const providerExecution = fakeExecution({ schemaVersion: 1, intents: 'nope' });
    const service = new ProviderStructuredIntentEmissionService({
      providerExecution,
      ids: { generate: () => 'exec-2' },
      clock: { now: () => new Date('2026-08-23T10:00:00.000Z') },
    });
    await expect(
      service.proposeIntents({
        run: {
          schemaVersion: 1,
          runId: 'run-2',
          projectId: 'proj-1',
          goal: 'Broken',
          phase: 'PLANNING',
          status: 'RUNNING',
          createdAt: '2026-08-23T10:00:00.000Z',
          updatedAt: '2026-08-23T10:00:00.000Z',
          references: {},
        },
      }),
    ).rejects.toBeInstanceOf(AgentRunError);
  });
});
