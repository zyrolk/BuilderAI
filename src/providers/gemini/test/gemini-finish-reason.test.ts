import {
  ProviderContractViolationError,
  ProviderOutputTruncatedError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import { createExecutionRequest } from '../../../core/execution-engine/test/execution-engine.fixture';
import type { ExecutionPolicy } from '../../../core/execution-engine';
import { GeminiProvider } from '../adapter';
import { GeminiResponseMapper } from '../mapper';
import { GeminiExecutionService } from '../services';
import { assertSuccessfulFinishReason, GeminiRawResponseValidator } from '../validators';
import {
  completedRawResponse,
  createGeminiConfiguration,
  createGeminiRequest,
  FakeGeminiClient,
  sequenceClock,
  validOutputText,
} from './gemini-provider.fixture';

/** Auto-incrementing ISO-timestamp clock giving deterministic elapsed-time control. */
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

describe('Gemini finishReason classification (ADR-026)', () => {
  it('accepts STOP as the only successful completion reason', () => {
    expect(() => assertSuccessfulFinishReason('STOP')).not.toThrow();
    expect(new GeminiRawResponseValidator().parse(completedRawResponse())).toMatchObject({
      finishReason: 'STOP',
    });
  });

  it('treats MAX_TOKENS as retryable truncation even when text is parseable JSON', async () => {
    const parseableJson = validOutputText();
    expect(() => assertSuccessfulFinishReason('MAX_TOKENS')).toThrow(ProviderOutputTruncatedError);
    expect(() =>
      new GeminiRawResponseValidator().parse({
        ...completedRawResponse(parseableJson),
        candidates: [{ finishReason: 'MAX_TOKENS' }],
      }),
    ).toThrow(ProviderOutputTruncatedError);

    const configuration = createGeminiConfiguration();
    const request = await createGeminiRequest();
    const client = new FakeGeminiClient({
      ...completedRawResponse(parseableJson),
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    });
    const provider = new GeminiProvider(
      configuration,
      client,
      sequenceClock(['2026-08-02T00:00:00.000Z', '2026-08-02T00:00:01.000Z']),
    );
    await expect(provider.execute(request)).rejects.toBeInstanceOf(ProviderOutputTruncatedError);
    expect(client.calls).toHaveLength(1);
  });

  it('retries exactly once after MAX_TOKENS and succeeds on STOP', async () => {
    let callCount = 0;
    const client: FakeGeminiClient = new FakeGeminiClient();
    client.generateContent = async (request, options) => {
      client.calls.push({ request, options });
      callCount += 1;
      if (callCount === 1) {
        return {
          ...completedRawResponse(validOutputText()),
          candidates: [{ finishReason: 'MAX_TOKENS' }],
        };
      }
      return completedRawResponse();
    };
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(
      configuration,
      client,
      tickClock('2026-08-02T00:00:00.000Z', 1_000),
    );
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-02T00:00:10.000Z', 1_000),
    );
    const executionRequest = await createExecutionRequest({
      policy: boundedRetryPolicy(30_000),
    });

    const output = await service.execute(executionRequest);

    expect(client.calls).toHaveLength(2);
    expect(output.executionResult.status).toBe('COMPLETED');
  });

  it('fails terminally when MAX_TOKENS persists across both attempts', async () => {
    const truncatedResponse = {
      ...completedRawResponse(validOutputText()),
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    };
    const client = new FakeGeminiClient(truncatedResponse);
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(
      configuration,
      client,
      tickClock('2026-08-02T00:00:00.000Z', 1_000),
    );
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-02T00:00:10.000Z', 1_000),
    );
    const executionRequest = await createExecutionRequest({
      policy: boundedRetryPolicy(30_000),
    });

    await expect(service.execute(executionRequest)).rejects.toBeInstanceOf(
      ProviderOutputTruncatedError,
    );
    expect(client.calls).toHaveLength(2);
  });

  it.each(['SAFETY', 'PROHIBITED_CONTENT', 'SPII', 'BLOCKLIST', 'RECITATION'] as const)(
    'does not retry policy termination for %s',
    async (finishReason) => {
      const client = new FakeGeminiClient({
        ...completedRawResponse(validOutputText()),
        candidates: [{ finishReason }],
      });
      const configuration = createGeminiConfiguration();
      const provider = new GeminiProvider(
        configuration,
        client,
        tickClock('2026-08-02T00:00:00.000Z', 1_000),
      );
      const service = new GeminiExecutionService(
        provider,
        configuration,
        tickClock('2026-08-02T00:00:10.000Z', 1_000),
      );
      const executionRequest = await createExecutionRequest({
        policy: boundedRetryPolicy(30_000),
      });

      await expect(service.execute(executionRequest)).rejects.toBeInstanceOf(
        ProviderContractViolationError,
      );
      expect(client.calls).toHaveLength(1);
    },
  );

  it.each([
    'MALFORMED_FUNCTION_CALL',
    'OTHER',
    'FINISH_REASON_UNSPECIFIED',
    'UNKNOWN_REASON',
  ] as const)('does not retry terminal contract finish reasons for %s', (finishReason) => {
    expect(() => assertSuccessfulFinishReason(finishReason)).toThrow(
      ProviderContractViolationError,
    );
    expect(() =>
      new GeminiRawResponseValidator().parse({
        ...completedRawResponse(),
        candidates: [{ finishReason }],
      }),
    ).toThrow(ProviderContractViolationError);
  });

  it('preserves existing PROVIDER_UNAVAILABLE bounded retry behavior', async () => {
    let callCount = 0;
    const client: FakeGeminiClient = new FakeGeminiClient();
    client.generateContent = async (request, options) => {
      client.calls.push({ request, options });
      callCount += 1;
      if (callCount === 1) throw new Error('offline');
      return completedRawResponse();
    };
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(
      configuration,
      client,
      tickClock('2026-08-02T00:00:00.000Z', 1_000),
    );
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-02T00:00:10.000Z', 1_000),
    );
    const executionRequest = await createExecutionRequest({
      policy: boundedRetryPolicy(30_000),
    });

    const output = await service.execute(executionRequest);

    expect(client.calls).toHaveLength(2);
    expect(output.executionResult.status).toBe('COMPLETED');
  });

  it('caps retried MAX_TOKENS attempts to the remaining timeout budget', async () => {
    let callCount = 0;
    const client: FakeGeminiClient = new FakeGeminiClient();
    client.generateContent = async (request, options) => {
      client.calls.push({ request, options });
      callCount += 1;
      if (callCount === 1) {
        return {
          ...completedRawResponse(validOutputText()),
          candidates: [{ finishReason: 'MAX_TOKENS' }],
        };
      }
      return completedRawResponse();
    };
    const configuration = createGeminiConfiguration({ maximumTimeoutMs: 30_000 });
    const provider = new GeminiProvider(
      configuration,
      client,
      tickClock('2026-08-02T00:00:00.000Z', 1_000),
    );
    const service = new GeminiExecutionService(
      provider,
      configuration,
      tickClock('2026-08-02T00:00:10.000Z', 1_000),
    );
    const executionRequest = await createExecutionRequest({
      policy: boundedRetryPolicy(30_000),
    });

    await service.execute(executionRequest);

    const [first, second] = client.calls;
    expect(first?.options.timeoutMs).toBeGreaterThan(0);
    expect(second?.options.timeoutMs).toBeGreaterThan(0);
    expect(second?.options.timeoutMs).toBeLessThan(
      first?.options.timeoutMs ?? Number.POSITIVE_INFINITY,
    );
  });

  it('does not expose raw provider output across the provider boundary on truncation or policy failure', async () => {
    const secretText = JSON.stringify({
      summary: 'secret-provider-text',
      artifacts: [],
      diagnostics: [],
    });
    const truncated = {
      ...completedRawResponse(secretText),
      candidates: [{ finishReason: 'MAX_TOKENS' }],
    };
    const request = await createGeminiRequest();
    const providerRequest = { contents: '[]', config: {} } as never;

    let truncationError: ProviderOutputTruncatedError | undefined;
    try {
      new GeminiResponseMapper(sequenceClock(['2026-08-02T00:00:00.000Z'])).map(
        truncated,
        request,
        providerRequest,
        '2026-08-02T00:00:00.000Z',
      );
    } catch (error: unknown) {
      truncationError = error as ProviderOutputTruncatedError;
    }
    expect(truncationError?.code).toBe('OUTPUT_TRUNCATED');
    expect(truncationError?.message).not.toContain('secret-provider-text');

    let policyError: ProviderContractViolationError | undefined;
    try {
      new GeminiResponseMapper(sequenceClock(['2026-08-02T00:00:00.000Z'])).map(
        {
          ...completedRawResponse(secretText),
          candidates: [{ finishReason: 'SAFETY' }],
        },
        request,
        providerRequest,
        '2026-08-02T00:00:00.000Z',
      );
    } catch (error: unknown) {
      policyError = error as ProviderContractViolationError;
    }
    expect(policyError?.code).toBe('CONTRACT_VIOLATION');
    expect(policyError?.message).not.toContain('secret-provider-text');
  });

  it('maps generic offline failures to PROVIDER_UNAVAILABLE without leaking raw response bodies', async () => {
    const client = new FakeGeminiClient(undefined, new Error('offline'));
    const provider = new GeminiProvider(createGeminiConfiguration(), client);
    await expect(provider.execute(await createGeminiRequest())).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(client.calls).toHaveLength(1);
  });
});
