import {
  ProviderCancelledError,
  ProviderOutputTruncatedError,
  ProviderTimeoutError,
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
import { createCorrectionPromptPackage } from '../../../core/prompt-orchestrator/test/truncation-retry.fixture';
import { GeminiProvider } from '../adapter';
import { GeminiExecutionService } from '../services';
import type {
  GeminiClient,
  GeminiExecutionAttemptLogger,
  GeminiExecutionAttemptTelemetry,
} from '../types';
import { GEMINI_PROVIDER_ID } from '../types';
import { createGeminiConfiguration, createGeminiRequest } from './gemini-provider.fixture';

function tickClock(startIso: string, stepMs: number): () => string {
  const start = Date.parse(startIso);
  let tick = 0;
  return () => new Date(start + stepMs * tick++).toISOString();
}

class AbortingGeminiClient implements GeminiClient {
  constructor(private readonly error: Error) {}

  generateContent(): Promise<unknown> {
    return Promise.reject(this.error);
  }
}

class RecordingAttemptLogger implements GeminiExecutionAttemptLogger {
  readonly events: GeminiExecutionAttemptTelemetry[] = [];

  recordAttempt(event: GeminiExecutionAttemptTelemetry): void {
    this.events.push(event);
  }
}

function boundedRetryPolicy(durationMs: number): ExecutionPolicy {
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
    },
    timeout: { durationMs, startsAt: 'QUEUED' },
  };
}

describe('Gemini transport timeout vs cancellation', () => {
  it('maps SDK AbortError without caller abort to TIMEOUT', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(configuration, new AbortingGeminiClient(abort));
    const request = await createGeminiRequest({ timeoutMs: configuration.maximumTimeoutMs });

    await expect(provider.execute(request)).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('maps caller-initiated abort to CANCELLED', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(configuration, new AbortingGeminiClient(abort));
    const cancellation: ExecutionCancellationToken = {
      cancelled: false,
      subscribe: (registered) => {
        registered('operator stop');
        return () => undefined;
      },
    };
    const request = await createGeminiRequest({
      timeoutMs: configuration.maximumTimeoutMs,
      cancellation,
    });

    await expect(provider.execute(request)).rejects.toBeInstanceOf(ProviderCancelledError);
  });
});

describe('GeminiExecutionService attempt telemetry', () => {
  const servicePath = 'src/application/workspace/activity-history.service.ts';
  const testPath = 'src/application/workspace/activity-history.service.test.ts';

  it('records safe attempt-1 telemetry without sensitive fields', async () => {
    const attemptLogger = new RecordingAttemptLogger();
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () =>
        Promise.resolve(
          createResponse({
            metadata: {
              'finish-reason': 'STOP',
              'input-tokens': 100,
              'output-tokens': 50,
            },
            artifacts: [
              {
                id: 'artifact-one',
                name: 'summary',
                kind: 'STRUCTURED_DATA',
                data: { summary: 'ok', artifacts: [], diagnostics: [] },
              },
            ],
          }),
        ),
    ]);
    const configuration = createGeminiConfiguration();
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
      attemptLogger,
    );
    const request = await createExecutionRequest({
      executionId: 'corr-safe-001',
      metadata: {
        correlationId: 'corr-safe-001',
        requestedAt: '2026-08-01T00:00:00.000Z',
        values: {},
      },
      policy: boundedRetryPolicy(30_000),
    });

    await service.execute(request);

    expect(attemptLogger.events).toHaveLength(1);
    expect(attemptLogger.events[0]).toMatchObject({
      correlationId: 'corr-safe-001',
      attempt: 1,
      boundingActive: false,
      compactionActive: false,
      allowlistCount: 0,
      outcome: 'SUCCEEDED',
      finishReason: 'STOP',
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(attemptLogger.events[0]?.attemptTimeoutMs).toBeGreaterThan(0);
    expect(attemptLogger.events[0]?.attemptTimeoutMs).toBeLessThanOrEqual(30_000);
    expect(JSON.stringify(attemptLogger.events)).not.toMatch(/apiKey|GEMINI_API_KEY|secret/i);
    expect(JSON.stringify(attemptLogger.events)).not.toContain('OUTPUT_TRUNCATION_RETRY');
  });

  it('records attempt-2 compaction telemetry with remaining timeout budget', async () => {
    const attemptLogger = new RecordingAttemptLogger();
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(new ProviderOutputTruncatedError(GEMINI_PROVIDER_ID)),
      () =>
        Promise.resolve(
          createResponse({
            metadata: { 'finish-reason': 'STOP', 'input-tokens': 90, 'output-tokens': 40 },
            artifacts: [
              {
                id: 'artifact-one',
                name: 'summary',
                kind: 'STRUCTURED_DATA',
                data: {
                  summary: 'ok',
                  artifacts: [
                    {
                      logicalPath: servicePath,
                      type: 'TEST',
                      content: 'export {};',
                      metadata: { description: 'fix', 'change-operation': 'UPDATE_FILE' },
                    },
                  ],
                  diagnostics: [],
                },
              },
            ],
          }),
        ),
    ]);
    const configuration = createGeminiConfiguration();
    const clock = tickClock('2026-08-01T00:00:00.000Z', 1_000);
    const service = new GeminiExecutionService(provider, configuration, clock, attemptLogger);
    const prompt = await createCorrectionPromptPackage({ updated: [servicePath, testPath] });
    const request = await createExecutionRequest({
      executionId: 'corr-safe-002',
      prompt,
      metadata: {
        correlationId: 'corr-safe-002',
        requestedAt: '2026-08-01T00:00:00.000Z',
        values: {},
      },
      policy: boundedRetryPolicy(30_000),
    });

    await service.execute(request);

    expect(attemptLogger.events).toHaveLength(2);
    expect(attemptLogger.events[0]).toMatchObject({
      attempt: 1,
      boundingActive: true,
      compactionActive: false,
      allowlistCount: 2,
      errorCode: 'OUTPUT_TRUNCATED',
      outcome: 'FAILED',
    });
    expect(attemptLogger.events[1]).toMatchObject({
      attempt: 2,
      boundingActive: true,
      compactionActive: true,
      allowlistCount: 2,
      outcome: 'SUCCEEDED',
    });
    expect(attemptLogger.events[1]?.attemptTimeoutMs).toBeLessThan(
      attemptLogger.events[0]?.attemptTimeoutMs ?? Number.POSITIVE_INFINITY,
    );
  });

  it('does not retry TIMEOUT failures', async () => {
    const failure = new ProviderTimeoutError(GEMINI_PROVIDER_ID, 180_000);
    const provider = new ScriptedProvider(createDescriptor(GEMINI_PROVIDER_ID), [
      () => Promise.reject(failure),
    ]);
    const service = new GeminiExecutionService(
      provider,
      createGeminiConfiguration(),
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBe(failure);
    expect(provider.calls).toHaveLength(1);
  });
});

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

describe('GeminiExecutionService transport timeout classification integration', () => {
  it('surfaces TIMEOUT (not CANCELLED) when the provider maps SDK abort to timeout', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const geminiProvider = new GeminiProvider(
      createGeminiConfiguration(),
      new AbortingGeminiClient(abort),
    );
    const service = new GeminiExecutionService(
      geminiProvider,
      createGeminiConfiguration(),
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});
