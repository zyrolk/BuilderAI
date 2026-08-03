import {
  InvalidProviderConfigurationError,
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderOutputTruncatedError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  type AIProvider,
  type AIProviderDescriptor,
  type AIProviderRequest,
  type AIProviderResponse,
} from '../../../core/ai-provider';
import {
  createDescriptor,
  createResponse,
} from '../../../core/ai-provider/test/ai-provider.fixture';
import type { ExecutionCancellationToken, ExecutionPolicy } from '../../../core/execution-engine';
import { createExecutionRequest } from '../../../core/execution-engine/test/execution-engine.fixture';
import {
  CORRECTION_OUTPUT_BOUNDING_METADATA,
  TRUNCATION_RETRY_METADATA_COMPACTION,
} from '../../../core/prompt-orchestrator';
import { createCorrectionPromptPackage } from '../../../core/prompt-orchestrator/test/truncation-retry.fixture';
import { OpenRouterExecutionService } from '../services';
import { OPENROUTER_PROVIDER_ID } from '../types';
import { createOpenRouterConfiguration } from './openrouter-provider.fixture';

function tickClock(startIso: string, stepMs: number): () => string {
  const start = Date.parse(startIso);
  let tick = 0;
  return () => new Date(start + stepMs * tick++).toISOString();
}

class ScriptedProvider implements AIProvider {
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
    if (behavior === undefined) throw new Error('Scripted provider exhausted.');
    return behavior();
  }
}

function structuredSuccess(requestId = 'execution-one'): () => Promise<AIProviderResponse> {
  return () =>
    Promise.resolve(
      createResponse({
        requestId,
        artifacts: [
          { id: 'artifact-one', name: 'summary', kind: 'STRUCTURED_DATA', data: { summary: 'ok' } },
        ],
      }),
    );
}

function unavailable(): () => Promise<AIProviderResponse> {
  return () => Promise.reject(new ProviderUnavailableError(OPENROUTER_PROVIDER_ID));
}

function truncated(): () => Promise<AIProviderResponse> {
  return () => Promise.reject(new ProviderOutputTruncatedError(OPENROUTER_PROVIDER_ID));
}

function structuredSuccessForPaths(
  paths: readonly string[],
  requestId = 'execution-one',
): () => Promise<AIProviderResponse> {
  return () =>
    Promise.resolve(
      createResponse({
        requestId,
        artifacts: [
          {
            id: 'artifact-one',
            name: 'summary',
            kind: 'STRUCTURED_DATA',
            data: {
              summary: 'ok',
              artifacts: paths.map((logicalPath) => ({
                logicalPath,
                type: 'TEST',
                content: 'export {};',
                metadata: { description: 'fix', 'change-operation': 'UPDATE_FILE' },
              })),
              diagnostics: [],
            },
          },
        ],
      }),
    );
}

function boundedRetryPolicy(
  durationMs: number,
  overrides: Partial<ExecutionPolicy['retry']> = {},
): ExecutionPolicy {
  return {
    priority: 'NORMAL',
    validationMode: 'STRICT',
    failureStrategy: 'RETRY_THEN_FAIL',
    retry: {
      maximumRetries: 1,
      delayStrategy: 'FIXED',
      baseDelayMs: 10,
      maximumDelayMs: 10,
      retryableErrorCodes: ['OUTPUT_TRUNCATED', 'PROVIDER_UNAVAILABLE'],
      ...overrides,
    },
    timeout: { durationMs, startsAt: 'QUEUED' },
  };
}

async function flushMicrotasks(times = 20): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe('OpenRouterExecutionService bounded retries (P1-5)', () => {
  it('retries exactly once after PROVIDER_UNAVAILABLE and then succeeds', async () => {
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      unavailable(),
      structuredSuccess(),
    ]);
    const configuration = createOpenRouterConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new OpenRouterExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    const output = await service.execute(request);

    expect(provider.calls).toHaveLength(2);
    expect(output.executionResult.status).toBe('COMPLETED');
    expect(output.structuredOutput).toMatchObject({ summary: 'ok' });
  });

  it('reuses the same executionId and PromptPackage across attempts without rebuilding it', async () => {
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      unavailable(),
      structuredSuccess(),
    ]);
    const configuration = createOpenRouterConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new OpenRouterExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await service.execute(request);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.requestId).toBe(request.executionId);
    expect(provider.calls[1]?.requestId).toBe(request.executionId);
    expect(provider.calls[0]?.prompt).toBe(request.prompt);
    expect(provider.calls[1]?.prompt).toBe(request.prompt);
    expect(provider.calls[1]?.metadata).toMatchObject({ attempt: 2 });
    expect(provider.calls[0]?.metadata).toMatchObject({ attempt: 1 });
  });

  it('caps the retried attempt to the remaining timeout budget instead of a fresh full timeout', async () => {
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      unavailable(),
      structuredSuccess(),
    ]);
    const configuration = createOpenRouterConfiguration({ maximumTimeoutMs: 30_000 });
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new OpenRouterExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await service.execute(request);

    const [first, second] = provider.calls;
    expect(first?.timeoutMs).toBeGreaterThan(0);
    expect(second?.timeoutMs).toBeGreaterThan(0);
    expect(second?.timeoutMs).toBeLessThan(first?.timeoutMs ?? Number.POSITIVE_INFINITY);
  });

  it('stops after exactly 2 total attempts and reaches FAILED when PROVIDER_UNAVAILABLE persists', async () => {
    const secondFailure = new ProviderUnavailableError(OPENROUTER_PROVIDER_ID);
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      unavailable(),
      () => Promise.reject(secondFailure),
    ]);
    const configuration = createOpenRouterConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new OpenRouterExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(secondFailure);
    expect(provider.calls).toHaveLength(2);
  });

  it('does not retry CONTRACT_VIOLATION failures', async () => {
    const failure = new ProviderContractViolationError('RESPONSE', [
      { path: '$.artifacts', message: 'invalid' },
    ]);
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createOpenRouterConfiguration();
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not retry INVALID_CONFIGURATION failures', async () => {
    const failure = new InvalidProviderConfigurationError([
      { path: '$.model', message: 'unsupported' },
    ]);
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createOpenRouterConfiguration();
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not retry CANCELLED failures', async () => {
    const failure = new ProviderCancelledError('execution-one', 'stopped');
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createOpenRouterConfiguration();
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not retry TIMEOUT failures under the launch policy', async () => {
    const failure = new ProviderTimeoutError(OPENROUTER_PROVIDER_ID, 1_000);
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createOpenRouterConfiguration();
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not perform a second provider call once cancellation fires during the retry delay', async () => {
    const failure = new ProviderUnavailableError(OPENROUTER_PROVIDER_ID);
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      () => Promise.reject(failure),
      structuredSuccess(),
    ]);
    const configuration = createOpenRouterConfiguration();
    let listener: ((reason?: string) => void) | undefined;
    const cancellation: ExecutionCancellationToken = {
      cancelled: false,
      subscribe: (registered) => {
        listener = registered;
        return () => undefined;
      },
    };
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({
      policy: boundedRetryPolicy(30_000, { baseDelayMs: 50, maximumDelayMs: 50 }),
      cancellation,
    });

    const promise = service.execute(request);
    await flushMicrotasks();
    expect(listener).toBeDefined();
    listener?.('cancelled during retry delay');

    await expect(promise).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });

  it('terminates via the timeout lifecycle when the budget is exhausted before a retry', async () => {
    const failure = new ProviderUnavailableError(OPENROUTER_PROVIDER_ID);
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      () => Promise.reject(failure),
      structuredSuccess(),
    ]);
    const configuration = createOpenRouterConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new OpenRouterExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(4_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });
});

describe('OpenRouterExecutionService OUTPUT_TRUNCATED retry compaction (ADR-029)', () => {
  const servicePath = 'src/application/workspace/activity-history.service.ts';

  it('compacts attempt 2 after OUTPUT_TRUNCATED on correction prepares', async () => {
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      truncated(),
      structuredSuccessForPaths([servicePath]),
    ]);
    const configuration = createOpenRouterConfiguration();
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const canonicalPrompt = await createCorrectionPromptPackage({ updated: [servicePath] });
    const request = await createExecutionRequest({
      prompt: canonicalPrompt,
      policy: boundedRetryPolicy(30_000),
    });

    await service.execute(request);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.metadata?.[CORRECTION_OUTPUT_BOUNDING_METADATA]).toBe(true);
    expect(provider.calls[1]?.metadata?.[TRUNCATION_RETRY_METADATA_COMPACTION]).toBe(true);
    expect(provider.calls[1]?.prompt).not.toBe(canonicalPrompt);
  });

  it('preserves identical-request retry for PROVIDER_UNAVAILABLE', async () => {
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      unavailable(),
      structuredSuccessForPaths([servicePath]),
    ]);
    const configuration = createOpenRouterConfiguration();
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const canonicalPrompt = await createCorrectionPromptPackage({ updated: [servicePath] });
    const request = await createExecutionRequest({
      prompt: canonicalPrompt,
      policy: boundedRetryPolicy(30_000),
    });

    await service.execute(request);

    expect(provider.calls[1]?.prompt).toBe(canonicalPrompt);
    expect(provider.calls[1]?.metadata?.[CORRECTION_OUTPUT_BOUNDING_METADATA]).toBe(true);
    expect(provider.calls[1]?.metadata?.[TRUNCATION_RETRY_METADATA_COMPACTION]).toBeUndefined();
  });

  it('rejects out-of-scope artifacts on compacted retry', async () => {
    const provider = new ScriptedProvider(createDescriptor(OPENROUTER_PROVIDER_ID), [
      truncated(),
      structuredSuccessForPaths(['src/application/workspace/activity-history.schemas.ts']),
    ]);
    const configuration = createOpenRouterConfiguration();
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({
      prompt: await createCorrectionPromptPackage({ updated: [servicePath] }),
      policy: boundedRetryPolicy(30_000),
    });

    await expect(service.execute(request)).rejects.toBeInstanceOf(ProviderContractViolationError);
  });
});
