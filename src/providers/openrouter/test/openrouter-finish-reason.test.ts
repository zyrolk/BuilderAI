import {
  ProviderContractViolationError,
  ProviderOutputTruncatedError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import { createExecutionRequest } from '../../../core/execution-engine/test/execution-engine.fixture';
import type { ExecutionPolicy } from '../../../core/execution-engine';
import { OpenRouterProvider } from '../adapter';
import { OpenRouterExecutionService } from '../services';
import { assertSuccessfulFinishReason, OpenRouterRawResponseValidator } from '../validators';
import {
  completedRawResponse,
  createOpenRouterConfiguration,
  createOpenRouterRequest,
  FakeOpenRouterChatClient,
  sequenceClock,
  validOutputText,
} from './openrouter-provider.fixture';

function tickClock(startIso: string, stepMs: number): () => string {
  const start = Date.parse(startIso);
  let tick = 0;
  return () => new Date(start + stepMs * tick++).toISOString();
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

describe('OpenRouter finish_reason classification (ADR-028)', () => {
  it('accepts stop as the only successful completion reason', () => {
    expect(() => assertSuccessfulFinishReason('stop')).not.toThrow();
    expect(new OpenRouterRawResponseValidator().parse(completedRawResponse())).toMatchObject({
      finishReason: 'stop',
    });
  });

  it('treats length as retryable truncation even when text is parseable JSON', async () => {
    const parseableJson = validOutputText();
    expect(() => assertSuccessfulFinishReason('length')).toThrow(ProviderOutputTruncatedError);
    expect(() =>
      new OpenRouterRawResponseValidator().parse({
        ...completedRawResponse(parseableJson),
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: parseableJson },
            finish_reason: 'length',
          },
        ],
      }),
    ).toThrow(ProviderOutputTruncatedError);

    const configuration = createOpenRouterConfiguration();
    const request = await createOpenRouterRequest();
    const client = new FakeOpenRouterChatClient({
      ...completedRawResponse(parseableJson),
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: parseableJson },
          finish_reason: 'length',
        },
      ],
    });
    const provider = new OpenRouterProvider(
      configuration,
      client,
      sequenceClock(['2026-08-02T00:00:00.000Z', '2026-08-02T00:00:01.000Z']),
    );
    await expect(provider.execute(request)).rejects.toBeInstanceOf(ProviderOutputTruncatedError);
    expect(client.calls).toHaveLength(1);
  });

  it('retries exactly once after length and succeeds on stop', async () => {
    let callCount = 0;
    const client = new FakeOpenRouterChatClient();
    client.create = async (request, options) => {
      client.calls.push({ request, options });
      callCount += 1;
      if (callCount === 1) {
        return {
          ...completedRawResponse(validOutputText()),
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: validOutputText() },
              finish_reason: 'length',
            },
          ],
        };
      }
      return completedRawResponse();
    };
    const configuration = createOpenRouterConfiguration();
    const provider = new OpenRouterProvider(
      configuration,
      client,
      tickClock('2026-08-02T00:00:00.000Z', 1_000),
    );
    const executionService = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-02T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    const output = await executionService.execute(request);

    expect(client.calls).toHaveLength(2);
    expect(output.executionResult.status).toBe('COMPLETED');
    expect(output.structuredOutput).toMatchObject({ summary: 'Completed.' });
  });

  it('treats content_filter as terminal CONTRACT_VIOLATION', () => {
    expect(() => assertSuccessfulFinishReason('content_filter')).toThrow(
      ProviderContractViolationError,
    );
  });

  it('treats malformed finish reasons as terminal CONTRACT_VIOLATION', () => {
    expect(() => assertSuccessfulFinishReason('tool_calls')).toThrow(
      ProviderContractViolationError,
    );
  });
});

describe('OpenRouterExecutionService bounded retries (ADR-019)', () => {
  it('retries exactly once after PROVIDER_UNAVAILABLE and then succeeds', async () => {
    let callCount = 0;
    const client = new FakeOpenRouterChatClient(
      undefined,
      new ProviderUnavailableError('openrouter-chat'),
    );
    client.create = async (request, options) => {
      client.calls.push({ request, options });
      callCount += 1;
      if (callCount === 1) throw new ProviderUnavailableError('openrouter-chat');
      return completedRawResponse();
    };
    const configuration = createOpenRouterConfiguration();
    const provider = new OpenRouterProvider(
      configuration,
      client,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    const output = await service.execute(request);

    expect(client.calls).toHaveLength(2);
    expect(output.executionResult.status).toBe('COMPLETED');
  });

  it('caps the retried attempt to the remaining timeout budget', async () => {
    let callCount = 0;
    const client = new FakeOpenRouterChatClient(
      undefined,
      new ProviderUnavailableError('openrouter-chat'),
    );
    client.create = async (request, options) => {
      client.calls.push({ request, options });
      callCount += 1;
      if (callCount === 1) throw new ProviderUnavailableError('openrouter-chat');
      return completedRawResponse();
    };
    const configuration = createOpenRouterConfiguration({ maximumTimeoutMs: 30_000 });
    const provider = new OpenRouterProvider(
      configuration,
      client,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await service.execute(request);

    const [first, second] = client.calls;
    expect(first?.options.timeoutMs).toBeGreaterThan(0);
    expect(second?.options.timeoutMs).toBeGreaterThan(0);
    expect(second?.options.timeoutMs).toBeLessThan(
      first?.options.timeoutMs ?? Number.POSITIVE_INFINITY,
    );
  });

  it('stops after exactly 2 total attempts when PROVIDER_UNAVAILABLE persists', async () => {
    const client = new FakeOpenRouterChatClient(
      undefined,
      new ProviderUnavailableError('openrouter-chat'),
    );
    const configuration = createOpenRouterConfiguration();
    const provider = new OpenRouterProvider(
      configuration,
      client,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(client.calls).toHaveLength(2);
  });

  it('does not retry CONTRACT_VIOLATION failures', async () => {
    const client = new FakeOpenRouterChatClient({
      ...completedRawResponse(),
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: validOutputText() },
          finish_reason: 'content_filter',
        },
      ],
    });
    const configuration = createOpenRouterConfiguration();
    const provider = new OpenRouterProvider(
      configuration,
      client,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const service = new OpenRouterExecutionService(
      provider,
      configuration,
      tickClock('2026-08-01T00:00:00.000Z', 1_000),
    );
    const request = await createExecutionRequest({ policy: boundedRetryPolicy(30_000) });

    await expect(service.execute(request)).rejects.toBeInstanceOf(ProviderContractViolationError);
    expect(client.calls).toHaveLength(1);
  });
});
