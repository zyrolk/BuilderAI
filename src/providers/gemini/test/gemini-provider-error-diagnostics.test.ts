import {
  ProviderCancelledError,
  ProviderOutputTruncatedError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import {
  extractSafeProviderUnavailableDiagnostics,
  GeminiErrorMapper,
} from '../adapter/gemini-error.mapper';
import { GeminiProvider } from '../adapter/gemini-provider';
import { GeminiExecutionService } from '../services';
import type {
  GeminiClient,
  GeminiExecutionAttemptLogger,
  GeminiExecutionAttemptTelemetry,
} from '../types';
import { assertSuccessfulFinishReason } from '../validators/gemini-finish-reason';
import { GeminiRawResponseValidator } from '../validators/gemini-raw-response.validator';
import { createGeminiConfiguration, createGeminiRequest } from './gemini-provider.fixture';
import { createExecutionRequest } from '../../../core/execution-engine/test/execution-engine.fixture';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';

const SECRET_MESSAGE = 'Authorization: Bearer GEMINI_API_KEY=super-secret-key';

describe('Gemini provider-error diagnostics', () => {
  const mapper = new GeminiErrorMapper();

  it('classifies HTTP 429 as PROVIDER_UNAVAILABLE with RATE_LIMIT diagnostics', () => {
    const mapped = mapper.map(
      {
        name: 'ApiError',
        status: 429,
        headers: { 'retry-after': '30' },
        message: SECRET_MESSAGE,
      },
      'request-one',
      100,
    );

    expect(mapped).toBeInstanceOf(ProviderUnavailableError);
    if (!(mapped instanceof ProviderUnavailableError)) return;
    expect(mapped.diagnostics).toMatchObject({
      providerStatus: 429,
      providerErrorCategory: 'RATE_LIMIT',
      sdkErrorName: 'ApiError',
      retryAfterMs: 30_000,
    });
    expect(JSON.stringify(mapped)).not.toContain('super-secret-key');
    expect(mapped.message).not.toContain('super-secret-key');
  });

  it('classifies HTTP 503 as PROVIDER_UNAVAILABLE with UPSTREAM_5XX diagnostics', () => {
    const mapped = mapper.map(
      { name: 'ApiError', status: 503, message: SECRET_MESSAGE },
      'req',
      100,
    );

    expect(mapped).toBeInstanceOf(ProviderUnavailableError);
    if (!(mapped instanceof ProviderUnavailableError)) return;
    expect(mapped.diagnostics).toMatchObject({
      providerStatus: 503,
      providerErrorCategory: 'UPSTREAM_5XX',
      sdkErrorName: 'ApiError',
    });
  });

  it('classifies ECONNRESET as TRANSPORT diagnostics', () => {
    const diagnostics = extractSafeProviderUnavailableDiagnostics({
      name: 'Error',
      code: 'ECONNRESET',
      message: SECRET_MESSAGE,
    });

    expect(diagnostics).toMatchObject({
      providerErrorCategory: 'TRANSPORT',
      providerErrorCode: 'ECONNRESET',
      sdkErrorName: 'Error',
    });
  });

  it('classifies unknown SDK errors as UNKNOWN diagnostics', () => {
    const mapped = mapper.map(
      { name: 'InternalSdkFailure', message: SECRET_MESSAGE },
      'request-one',
      100,
    );

    expect(mapped).toBeInstanceOf(ProviderUnavailableError);
    if (!(mapped instanceof ProviderUnavailableError)) return;
    expect(mapped.diagnostics).toMatchObject({
      providerErrorCategory: 'UNKNOWN',
      sdkErrorName: 'InternalSdkFailure',
    });
  });

  it('preserves TIMEOUT classification for TimeoutError', () => {
    expect(
      mapper.map(Object.assign(new Error('slow'), { name: 'TimeoutError' }), 'request-one', 100),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it('preserves TIMEOUT classification for ETIMEDOUT', () => {
    expect(
      mapper.map(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }), 'request-one', 100),
    ).toBeInstanceOf(ProviderTimeoutError);
  });

  it('preserves CANCELLED classification for caller abort', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(
      mapper.map(abort, 'request-one', 100, {
        callerInitiatedAbort: true,
        cancellationReason: 'operator stop',
      }),
    ).toBeInstanceOf(ProviderCancelledError);
  });

  it('preserves OUTPUT_TRUNCATED for MAX_TOKENS with safe token telemetry metadata', () => {
    expect(() => assertSuccessfulFinishReason('MAX_TOKENS')).toThrow(ProviderOutputTruncatedError);

    let truncated: ProviderOutputTruncatedError | undefined;
    try {
      assertSuccessfulFinishReason('MAX_TOKENS', {
        finishReason: 'MAX_TOKENS',
        inputTokens: 1200,
        outputTokens: 16000,
      });
    } catch (error: unknown) {
      truncated = error as ProviderOutputTruncatedError;
    }
    expect(truncated?.diagnostics).toMatchObject({
      finishReason: 'MAX_TOKENS',
      inputTokens: 1200,
      outputTokens: 16000,
    });
  });

  it('derives MAX_TOKENS diagnostics from validated raw responses', () => {
    const validator = new GeminiRawResponseValidator();
    let truncated: ProviderOutputTruncatedError | undefined;
    try {
      validator.parse({
        text: '{"summary":"x","artifacts":[],"diagnostics":[]}',
        candidates: [{ finishReason: 'MAX_TOKENS' }],
        usageMetadata: {
          promptTokenCount: 900,
          candidatesTokenCount: 16000,
          totalTokenCount: 16900,
        },
      });
    } catch (error: unknown) {
      truncated = error as ProviderOutputTruncatedError;
    }
    expect(truncated).toBeInstanceOf(ProviderOutputTruncatedError);
    expect(truncated?.diagnostics).toMatchObject({
      finishReason: 'MAX_TOKENS',
      inputTokens: 900,
      outputTokens: 16000,
    });
  });

  it('does not serialize secrets or raw provider messages in attempt telemetry', async () => {
    const attemptLogger = new RecordingAttemptLogger();
    class FailingClient implements GeminiClient {
      generateContent(): Promise<unknown> {
        return Promise.reject({
          name: 'ApiError',
          status: 429,
          headers: { 'retry-after': '15', Authorization: SECRET_MESSAGE },
          message: SECRET_MESSAGE,
        });
      }
    }
    const provider = new GeminiProvider(createGeminiConfiguration(), new FailingClient());
    const service = new GeminiExecutionService(
      provider,
      createGeminiConfiguration(),
      () => '2026-08-01T00:00:00.000Z',
      attemptLogger,
    );
    const request = await createExecutionRequest({
      executionId: 'corr-diagnostics-001',
      metadata: {
        correlationId: 'corr-diagnostics-001',
        requestedAt: '2026-08-01T00:00:00.000Z',
        values: {},
      },
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

    await expect(service.execute(request)).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(attemptLogger.events).toHaveLength(1);
    expect(attemptLogger.events[0]).toMatchObject({
      outcome: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    const serialized = JSON.stringify(attemptLogger.events);
    expect(serialized).not.toMatch(/GEMINI_API_KEY|super-secret-key|Authorization/i);
    expect(serialized).not.toContain(SECRET_MESSAGE);
  });
});

class RecordingAttemptLogger implements GeminiExecutionAttemptLogger {
  readonly events: GeminiExecutionAttemptTelemetry[] = [];

  recordAttempt(event: GeminiExecutionAttemptTelemetry): void {
    this.events.push(event);
  }
}

describe('Gemini provider-error diagnostics transport integration', () => {
  it('maps SDK transport failures through GeminiProvider without leaking messages', async () => {
    class TransportClient implements GeminiClient {
      generateContent(): Promise<unknown> {
        const error = Object.assign(new Error(SECRET_MESSAGE), {
          name: 'TypeError',
          code: 'ECONNRESET',
        });
        return Promise.reject(error);
      }
    }
    const provider = new GeminiProvider(createGeminiConfiguration(), new TransportClient());
    const cancellation: ExecutionCancellationToken = {
      cancelled: false,
      subscribe: () => () => undefined,
    };
    const request = await createGeminiRequest({
      timeoutMs: 1_000,
      cancellation,
    });

    try {
      await provider.execute(request);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      if (!(error instanceof ProviderUnavailableError)) return;
      expect(error.diagnostics).toMatchObject({
        providerErrorCategory: 'TRANSPORT',
        providerErrorCode: 'ECONNRESET',
        sdkErrorName: 'TypeError',
      });
      expect(error.message).not.toContain('super-secret-key');
    }
  });
});
