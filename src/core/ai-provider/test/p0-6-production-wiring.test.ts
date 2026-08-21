import { describe, expect, it } from 'vitest';

import { CoordinatorProviderExecutionService } from '../services/coordinator-provider-execution.service';
import { DEFAULT_PROVIDER_RETRY_CONFIGURATION } from '../services/provider-retry-policy';
import type { AIProvider } from '../ports/ai-provider';
import {
  ProviderUnavailableError,
  InvalidProviderConfigurationError,
  type AIProviderDescriptor,
  type AIProviderRequest,
  type AIProviderResponse,
} from '../types';
import { createDescriptor, createResponse } from '../test/ai-provider.fixture';
import { createExecutionRequest } from '../../execution-engine/test/execution-engine.fixture';
import { OPENAI_PROVIDER_ID } from '../../../providers/openai/types';
import { createOpenAIConfiguration } from '../../../providers/openai/test/openai-provider.fixture';
import {
  OpenAIExecutionService,
  createOpenAICoordinatorRoute,
} from '../../../providers/openai/services/openai-execution.service';
import {
  GeminiExecutionService,
  createGeminiCoordinatorRoute,
} from '../../../providers/gemini/services/gemini-execution.service';
import { GEMINI_PROVIDER_ID } from '../../../providers/gemini/types';
import { createGeminiConfiguration } from '../../../providers/gemini/test/gemini-provider.fixture';

class SingleCallScriptedProvider implements AIProvider {
  readonly calls: AIProviderRequest[] = [];
  private index = 0;

  constructor(
    readonly descriptor: AIProviderDescriptor,
    private readonly script: ReadonlyArray<() => Promise<AIProviderResponse>>,
  ) {}

  async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
    this.calls.push(request);
    const behavior = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (behavior === undefined) throw new Error('Script exhausted.');
    return behavior();
  }
}

function success(): () => Promise<AIProviderResponse> {
  return () =>
    Promise.resolve(
      createResponse({
        artifacts: [
          {
            id: 'a1',
            name: 'plan',
            kind: 'STRUCTURED_DATA',
            data: { summary: 'ok', artifacts: [] },
          },
        ],
      }),
    );
}

function unavailable(providerId: string): () => Promise<AIProviderResponse> {
  return () => Promise.reject(new ProviderUnavailableError(providerId));
}

describe('P0-6 production wiring: CoordinatorProviderExecutionService', () => {
  it('uses ProviderCoordinator for retries — adapter receives one call per attempt', async () => {
    const adapter = new SingleCallScriptedProvider(createDescriptor(OPENAI_PROVIDER_ID), [
      unavailable(OPENAI_PROVIDER_ID),
      success(),
    ]);
    const configuration = createOpenAIConfiguration();
    const execution = new CoordinatorProviderExecutionService(
      {
        routes: [createOpenAICoordinatorRoute(adapter, configuration)],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 2 },
      },
      () => new Date().toISOString(),
      undefined,
      async () => false,
    );
    const request = await createExecutionRequest({
      policy: {
        priority: 'NORMAL',
        validationMode: 'STRICT',
        failureStrategy: 'RETRY_THEN_FAIL',
        retry: {
          maximumRetries: 1,
          delayStrategy: 'FIXED',
          baseDelayMs: 1,
          maximumDelayMs: 1,
          retryableErrorCodes: ['PROVIDER_UNAVAILABLE'],
        },
        timeout: { durationMs: 30_000, startsAt: 'QUEUED' },
      },
    });

    const output = await execution.execute(request);

    expect(adapter.calls).toHaveLength(2);
    expect(output.executionResult.status).toBe('COMPLETED');
  });

  it('OpenAIExecutionService delegates to coordinator — no independent retry loop', async () => {
    const adapter = new SingleCallScriptedProvider(createDescriptor(OPENAI_PROVIDER_ID), [
      unavailable(OPENAI_PROVIDER_ID),
      success(),
    ]);
    const service = new OpenAIExecutionService(
      adapter,
      createOpenAIConfiguration(),
      () => new Date().toISOString(),
      async () => false,
    );
    const request = await createExecutionRequest({
      policy: {
        priority: 'NORMAL',
        validationMode: 'STRICT',
        failureStrategy: 'RETRY_THEN_FAIL',
        retry: {
          maximumRetries: 1,
          delayStrategy: 'FIXED',
          baseDelayMs: 1,
          maximumDelayMs: 1,
          retryableErrorCodes: ['PROVIDER_UNAVAILABLE'],
        },
        timeout: { durationMs: 30_000, startsAt: 'QUEUED' },
      },
    });

    await service.execute(request);

    expect(adapter.calls).toHaveLength(2);
  });

  it('GeminiExecutionService delegates to coordinator — no independent retry loop', async () => {
    const adapter = new SingleCallScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      unavailable(GEMINI_PROVIDER_ID),
      success(),
    ]);
    const service = new GeminiExecutionService(
      adapter,
      createGeminiConfiguration(),
      () => new Date().toISOString(),
      undefined,
      async () => false,
    );
    const request = await createExecutionRequest({
      policy: {
        priority: 'NORMAL',
        validationMode: 'STRICT',
        failureStrategy: 'RETRY_THEN_FAIL',
        retry: {
          maximumRetries: 1,
          delayStrategy: 'FIXED',
          baseDelayMs: 1,
          maximumDelayMs: 1,
          retryableErrorCodes: ['PROVIDER_UNAVAILABLE'],
        },
        timeout: { durationMs: 30_000, startsAt: 'QUEUED' },
      },
    });

    await service.execute(request);

    expect(adapter.calls).toHaveLength(2);
  });

  it('fallback route is tried after primary exhausts attempts', async () => {
    const primary = new SingleCallScriptedProvider(createDescriptor('primary'), [
      unavailable('primary'),
      unavailable('primary'),
    ]);
    const fallback = new SingleCallScriptedProvider(createDescriptor('fallback'), [success()]);
    const configuration = createOpenAIConfiguration();
    const execution = new CoordinatorProviderExecutionService(
      {
        routes: [
          createOpenAICoordinatorRoute(primary, configuration),
          {
            providerId: 'fallback',
            provider: fallback,
            mapRequest: (request, attempt, timeoutMs, resolution) =>
              createOpenAICoordinatorRoute(fallback, configuration).mapRequest(
                request,
                attempt,
                timeoutMs,
                resolution,
              ),
          },
        ],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 1 },
      },
      () => new Date().toISOString(),
      undefined,
      async () => false,
    );
    const request = await createExecutionRequest({
      policy: {
        priority: 'NORMAL',
        validationMode: 'STRICT',
        failureStrategy: 'FAIL_FAST',
        retry: {
          maximumRetries: 0,
          delayStrategy: 'NONE',
          baseDelayMs: 0,
          maximumDelayMs: 0,
          retryableErrorCodes: [],
        },
        timeout: { durationMs: 30_000, startsAt: 'QUEUED' },
      },
    });

    const output = await execution.execute(request);

    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
    expect(output.executionResult.status).toBe('COMPLETED');
    expect(output.executionResult.metadata['coordinator-fallback-used']).toBe(true);
  });

  it('non-retryable errors do not trigger fallback', async () => {
    const primary = new SingleCallScriptedProvider(createDescriptor('primary'), [
      () =>
        Promise.reject(new InvalidProviderConfigurationError([{ path: '$.key', message: 'bad' }])),
    ]);
    const fallback = new SingleCallScriptedProvider(createDescriptor('fallback'), [success()]);
    const configuration = createOpenAIConfiguration();
    const execution = new CoordinatorProviderExecutionService({
      routes: [
        createOpenAICoordinatorRoute(primary, configuration),
        {
          providerId: 'fallback',
          provider: fallback,
          mapRequest: (request, attempt, timeoutMs, resolution) =>
            createOpenAICoordinatorRoute(fallback, configuration).mapRequest(
              request,
              attempt,
              timeoutMs,
              resolution,
            ),
        },
      ],
      retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 3 },
    });
    const request = await createExecutionRequest();

    await expect(execution.execute(request)).rejects.toBeInstanceOf(
      InvalidProviderConfigurationError,
    );
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);
  });

  it('total calls never exceed routes × maximumAttempts', async () => {
    let totalCalls = 0;
    const mkAdapter = (id: string) =>
      new SingleCallScriptedProvider(createDescriptor(id), [
        () => {
          totalCalls += 1;
          return Promise.reject(new ProviderUnavailableError(id));
        },
      ]);
    const configuration = createOpenAIConfiguration();
    const execution = new CoordinatorProviderExecutionService(
      {
        routes: [
          createOpenAICoordinatorRoute(mkAdapter('a'), configuration),
          createGeminiCoordinatorRoute(mkAdapter('b'), createGeminiConfiguration()),
        ],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 2 },
      },
      () => new Date().toISOString(),
      undefined,
      async () => false,
    );
    const request = await createExecutionRequest({
      policy: {
        priority: 'NORMAL',
        validationMode: 'STRICT',
        failureStrategy: 'RETRY_THEN_FAIL',
        retry: {
          maximumRetries: 1,
          delayStrategy: 'FIXED',
          baseDelayMs: 1,
          maximumDelayMs: 1,
          retryableErrorCodes: ['PROVIDER_UNAVAILABLE'],
        },
        timeout: { durationMs: 30_000, startsAt: 'QUEUED' },
      },
    });

    await expect(execution.execute(request)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(totalCalls).toBe(4);
  });
});
