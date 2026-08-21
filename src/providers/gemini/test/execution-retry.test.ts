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
import { createPromptPackage } from '../../../core/prompt-orchestrator/test/prompt-orchestrator.fixture';
import { createCorrectionPromptPackage } from '../../../core/prompt-orchestrator/test/truncation-retry.fixture';
import {
  TRUNCATION_RETRY_METADATA_COMPACTION,
  CORRECTION_OUTPUT_BOUNDING_METADATA,
} from '../../../core/prompt-orchestrator';
import { GeminiExecutionService } from '../services';
import { GEMINI_PROVIDER_ID } from '../types';
import { createGeminiConfiguration } from './gemini-provider.fixture';

/** Auto-incrementing ISO-timestamp clock giving deterministic elapsed-time control. */
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

function truncated(): () => Promise<AIProviderResponse> {
  return () => Promise.reject(new ProviderOutputTruncatedError(GEMINI_PROVIDER_ID));
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

function unavailable(): () => Promise<AIProviderResponse> {
  return () => Promise.reject(new ProviderUnavailableError(GEMINI_PROVIDER_ID));
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

describe('GeminiExecutionService bounded retries (P1-5)', () => {
  it('retries exactly once after PROVIDER_UNAVAILABLE and then succeeds', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      unavailable(),
      structuredSuccess(),
    ]);
    const configuration = createGeminiConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new GeminiExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    const output = await service.execute(request);

    expect(provider.calls).toHaveLength(2);
    expect(output.executionResult.status).toBe('COMPLETED');
    expect(output.structuredOutput).toMatchObject({ summary: 'ok' });
  });

  it('reuses the same executionId and PromptPackage across attempts without rebuilding it', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      unavailable(),
      structuredSuccess(),
    ]);
    const configuration = createGeminiConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new GeminiExecutionService(provider, configuration, clock);
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
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      unavailable(),
      structuredSuccess(),
    ]);
    const configuration = createGeminiConfiguration({ maximumTimeoutMs: 30_000 });
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new GeminiExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await service.execute(request);

    const [first, second] = provider.calls;
    expect(first?.timeoutMs).toBeGreaterThan(0);
    expect(second?.timeoutMs).toBeGreaterThan(0);
    expect(second?.timeoutMs).toBeLessThan(first?.timeoutMs ?? Number.POSITIVE_INFINITY);
  });

  it('stops after exactly 2 total attempts and reaches FAILED when PROVIDER_UNAVAILABLE persists', async () => {
    const secondFailure = new ProviderUnavailableError(GEMINI_PROVIDER_ID);
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      unavailable(),
      () => Promise.reject(secondFailure),
    ]);
    const configuration = createGeminiConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new GeminiExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(secondFailure);
    expect(provider.calls).toHaveLength(2);
  });

  it('does not retry CONTRACT_VIOLATION failures', async () => {
    const failure = new ProviderContractViolationError('RESPONSE', [
      { path: '$.artifacts', message: 'invalid' },
    ]);
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
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
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
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
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not retry TIMEOUT failures under the launch policy', async () => {
    const failure = new ProviderTimeoutError(GEMINI_PROVIDER_ID, 1_000);
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not perform a second provider call once cancellation fires during the retry delay', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(new ProviderUnavailableError(GEMINI_PROVIDER_ID)),
      structuredSuccess(),
    ]);
    const configuration = createGeminiConfiguration();
    const cancellation: ExecutionCancellationToken = {
      cancelled: false,
      subscribe: (registered) => {
        registered('cancelled during retry delay');
        return () => undefined;
      },
    };
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
      undefined,
      async () => true,
    );
    const request = await createExecutionRequest({
      policy: boundedRetryPolicy(30_000, { baseDelayMs: 50, maximumDelayMs: 50 }),
      cancellation,
    });

    await expect(service.execute(request)).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(provider.calls).toHaveLength(1);
  });

  it('terminates via the timeout lifecycle and rethrows the original error when the budget is exhausted before a retry', async () => {
    const failure = new ProviderUnavailableError(GEMINI_PROVIDER_ID);
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(failure),
      structuredSuccess(),
    ]);
    const configuration = createGeminiConfiguration();
    const clockStart = '2026-08-01T00:00:00.000Z';
    const clock = tickClock(clockStart, 1_000);
    const service = new GeminiExecutionService(provider, configuration, clock);
    const request = await createExecutionRequest({
      policy: boundedRetryPolicy(5_000),
      metadata: {
        correlationId: 'sprint-six',
        requestedAt: clockStart,
        values: { purpose: 'execution-contract-test' },
      },
    });

    await expect(service.execute(request)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(provider.calls).toHaveLength(1);
  });
});

describe('GeminiExecutionService OUTPUT_TRUNCATED retry compaction (ADR-029)', () => {
  const servicePath = 'src/application/workspace/activity-history.service.ts';
  const testPath = 'src/application/workspace/activity-history.service.test.ts';

  it('applies attempt-1 correction bounding without compaction on STOP', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      structuredSuccessForPaths([servicePath, testPath]),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const canonicalPrompt = await createCorrectionPromptPackage({
      updated: [servicePath, testPath],
    });
    const request = await createExecutionRequest({
      prompt: canonicalPrompt,
      policy: boundedRetryPolicy(30_000),
    });

    await service.execute(request);

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.prompt).toBe(canonicalPrompt);
    expect(provider.calls[0]?.metadata?.[CORRECTION_OUTPUT_BOUNDING_METADATA]).toBe(true);
    expect(provider.calls[0]?.metadata?.[TRUNCATION_RETRY_METADATA_COMPACTION]).toBeUndefined();
    const iteration = provider.calls[0]?.prompt.sections.find(({ kind }) => kind === 'ITERATION');
    expect(iteration?.kind).toBe('ITERATION');
    if (iteration?.kind !== 'ITERATION') throw new Error('Expected iteration section.');
    expect(
      iteration.instructions.some(({ text }) => text.includes('OUTPUT_TRUNCATION_RETRY')),
    ).toBe(false);
  });

  it('compacts attempt 2 after OUTPUT_TRUNCATED and accepts in-scope structured output', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      truncated(),
      structuredSuccessForPaths([servicePath, testPath]),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const canonicalPrompt = await createCorrectionPromptPackage({
      updated: [servicePath, testPath],
    });
    const request = await createExecutionRequest({
      prompt: canonicalPrompt,
      policy: boundedRetryPolicy(30_000),
    });

    const output = await service.execute(request);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.prompt).toBe(canonicalPrompt);
    expect(provider.calls[0]?.metadata?.[CORRECTION_OUTPUT_BOUNDING_METADATA]).toBe(true);
    expect(provider.calls[1]?.prompt).not.toBe(canonicalPrompt);
    expect(provider.calls[1]?.metadata?.[TRUNCATION_RETRY_METADATA_COMPACTION]).toBe(true);
    const iteration = provider.calls[1]?.prompt.sections.find(({ kind }) => kind === 'ITERATION');
    expect(iteration?.kind).toBe('ITERATION');
    if (iteration?.kind !== 'ITERATION') throw new Error('Expected iteration section.');
    expect(
      iteration.instructions.some(({ text }) => text.includes('OUTPUT_TRUNCATION_RETRY')),
    ).toBe(true);
    expect(provider.calls[1]?.prompt.budget.characters).toBe(
      JSON.stringify(provider.calls[1]?.prompt).length,
    );
    expect(output.executionResult.status).toBe('COMPLETED');
  });

  it('terminates with OUTPUT_TRUNCATED when truncation persists across both attempts', async () => {
    const failure = new ProviderOutputTruncatedError(GEMINI_PROVIDER_ID);
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(failure),
      () => Promise.reject(failure),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({
      prompt: await createCorrectionPromptPackage({ updated: [servicePath] }),
      policy: boundedRetryPolicy(30_000),
    });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(2);
  });

  it('does not apply truncation compaction for PROVIDER_UNAVAILABLE retries', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      unavailable(),
      structuredSuccessForPaths([servicePath]),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
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
    expect(provider.calls[0]?.prompt).toBe(canonicalPrompt);
    expect(provider.calls[1]?.prompt).toBe(canonicalPrompt);
    expect(provider.calls[1]?.metadata?.[CORRECTION_OUTPUT_BOUNDING_METADATA]).toBe(true);
    expect(provider.calls[1]?.metadata?.[TRUNCATION_RETRY_METADATA_COMPACTION]).toBeUndefined();
  });

  it('rejects out-of-scope artifacts on compacted retry before returning success', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      truncated(),
      structuredSuccessForPaths(['src/application/workspace/activity-history.schemas.ts']),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({
      prompt: await createCorrectionPromptPackage({ updated: [servicePath] }),
      policy: boundedRetryPolicy(30_000),
    });

    await expect(service.execute(request)).rejects.toBeInstanceOf(ProviderContractViolationError);
    expect(provider.calls).toHaveLength(2);
  });

  it('leaves ordinary non-correction prepares unchanged on OUTPUT_TRUNCATED retry', async () => {
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      truncated(),
      structuredSuccess(),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const canonicalPrompt = await createPromptPackage();
    const request = await createExecutionRequest({
      prompt: canonicalPrompt,
      policy: boundedRetryPolicy(30_000),
    });

    await service.execute(request);

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0]?.prompt).toBe(canonicalPrompt);
    expect(provider.calls[1]?.prompt).toBe(canonicalPrompt);
    expect(provider.calls[1]?.metadata?.[TRUNCATION_RETRY_METADATA_COMPACTION]).toBeUndefined();
  });
});
