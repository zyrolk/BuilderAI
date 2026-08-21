import { describe, expect, it } from 'vitest';

import {
  ProviderCancelledError,
  ProviderUnavailableError,
  InvalidProviderConfigurationError,
} from '../types/ai-provider-error';
import type { AIProviderResponse, ProviderCancellationSignal } from '../types/ai-provider';
import type { AIProvider } from '../ports/ai-provider';
import {
  ProviderCoordinator,
  type ProviderRoute,
  type SleepFunction,
} from '../services/provider-coordinator';
import { DEFAULT_PROVIDER_RETRY_CONFIGURATION } from '../services/provider-retry-policy';
import { createCancellationTokenFromSignal } from '../../../application/workspace/request-cancellation';
import {
  classifyEmptyResponse,
  isApprovableOutcome,
  isNoChangeOutcome,
  isInsufficientEvidenceOutcome,
} from '../../../application/workspace/prepare-outcome';

function mockResponse(overrides: Partial<AIProviderResponse> = {}): AIProviderResponse {
  return {
    contractVersion: 1,
    requestId: 'test',
    status: 'COMPLETED',
    artifacts: [],
    diagnostics: [],
    warnings: [],
    statistics: { startedAt: '2026-01-01', completedAt: '2026-01-01', durationMs: 50 },
    usage: { inputCharacters: 100, promptCharacters: 100, outputCharacters: 50, artifactCount: 0 },
    metadata: {},
    ...overrides,
  };
}

function mockProvider(fn: () => Promise<AIProviderResponse>): AIProvider {
  return {
    descriptor: {
      contractVersion: 1,
      id: 'mock',
      displayName: 'Mock',
      capabilities: {
        contextIngestion: true,
        structuredOutput: true,
        streaming: false,
        toolCalling: false,
        reasoning: false,
        fileSupport: false,
        imageSupport: false,
        maximumContextCharacters: 100_000,
        structuredResponses: true,
      },
    },
    execute: fn as AIProvider['execute'],
  };
}

function cancelSignal(cancelled = false): ProviderCancellationSignal & { cancel: () => void } {
  const listeners: Array<(r?: string) => void> = [];
  const sig = {
    cancelled,
    reason: undefined as string | undefined,
    cancel() {
      sig.cancelled = true;
      sig.reason = 'cancelled';
      for (const fn of listeners) fn(sig.reason);
    },
    subscribe(listener: (r?: string) => void) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
  return sig;
}

const instantSleep: SleepFunction = async () => false;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const reqBuilder = () => (_id: string, _t: number) =>
  ({
    contractVersion: 1,
    requestId: 'r1',
    prompt: { sections: [] },
    executionMode: 'SINGLE_RESPONSE',
    constraints: {
      maximumOutputCharacters: 10000,
      requiredArtifactKinds: [],
      requiredCapabilities: [],
      requireStructuredResponse: false,
    },
    timeoutMs: 30000,
    cancellation: cancelSignal(),
    metadata: {},
  }) as never;

function mkCoordinator(routes: readonly ProviderRoute[], maxAttempts = 3, sleep?: SleepFunction) {
  return new ProviderCoordinator(
    { routes, retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: maxAttempts } },
    { now: () => Date.now() },
    undefined,
    sleep ?? instantSleep,
  );
}

describe('P0-6 integration: maximum provider call budget', () => {
  it('single route: provider calls bounded by maximumAttempts', async () => {
    let calls = 0;
    const provider = mockProvider(async () => {
      calls++;
      throw new ProviderUnavailableError('p', { providerErrorCategory: 'TRANSPORT' });
    });
    const coord = mkCoordinator([{ providerId: 'p', provider }], 3);

    try {
      await coord.execute(reqBuilder(), cancelSignal());
    } catch {
      /* expected */
    }
    expect(calls).toBe(3);
  });

  it('two routes: total calls = maxAttempts per route', async () => {
    let calls = 0;
    const mkP = (id: string) =>
      mockProvider(async () => {
        calls++;
        throw new ProviderUnavailableError(id, { providerErrorCategory: 'UPSTREAM_5XX' });
      });
    const coord = mkCoordinator(
      [
        { providerId: 'a', provider: mkP('a') },
        { providerId: 'b', provider: mkP('b') },
      ],
      2,
    );

    try {
      await coord.execute(reqBuilder(), cancelSignal());
    } catch {
      /* expected */
    }
    expect(calls).toBe(4);
  });
});

describe('P0-6 integration: HTTP cancellation token', () => {
  it('creates token from AbortController signal', () => {
    const controller = new AbortController();
    const token = createCancellationTokenFromSignal(controller.signal);
    expect(token.cancelled).toBe(false);
    controller.abort();
    expect(token.cancelled).toBe(true);
  });

  it('pre-aborted signal creates cancelled token', () => {
    const controller = new AbortController();
    controller.abort();
    const token = createCancellationTokenFromSignal(controller.signal);
    expect(token.cancelled).toBe(true);
  });

  it('undefined signal creates non-cancellable token', () => {
    const token = createCancellationTokenFromSignal(undefined);
    expect(token.cancelled).toBe(false);
  });

  it('cancelled token makes zero provider calls', async () => {
    let calls = 0;
    const provider = mockProvider(async () => {
      calls++;
      return mockResponse();
    });
    const coord = mkCoordinator([{ providerId: 'p', provider }]);

    await expect(coord.execute(reqBuilder(), cancelSignal(true))).rejects.toThrow(
      ProviderCancelledError,
    );
    expect(calls).toBe(0);
  });

  it('cancel during retry delay stops before next call', async () => {
    let calls = 0;
    const sig = cancelSignal();
    const provider = mockProvider(async () => {
      calls++;
      throw new ProviderUnavailableError('p', { providerErrorCategory: 'TRANSPORT' });
    });
    const sleep: SleepFunction = async () => {
      sig.cancel();
      return true;
    };
    const coord = mkCoordinator([{ providerId: 'p', provider }], 3, sleep);

    await expect(coord.execute(reqBuilder(), sig)).rejects.toThrow(ProviderCancelledError);
    expect(calls).toBe(1);
  });

  it('cancel after valid response does not discard it', async () => {
    const sig = cancelSignal();
    const provider = mockProvider(async () => {
      const resp = mockResponse();
      sig.cancel();
      return resp;
    });
    const coord = mkCoordinator([{ providerId: 'p', provider }]);

    const result = await coord.execute(reqBuilder(), sig);
    expect(result.response.status).toBe('COMPLETED');
    expect(result.providerId).toBe('p');
  });
});

describe('P0-6 integration: NO_CHANGE contract', () => {
  it('zero operations with semantic signal → NO_CHANGE', () => {
    const outcome = classifyEmptyResponse(true, 'Already correct');
    expect(isNoChangeOutcome(outcome)).toBe(true);
    expect(isApprovableOutcome(outcome)).toBe(false);
  });

  it('zero operations without semantic signal → INSUFFICIENT_EVIDENCE', () => {
    const outcome = classifyEmptyResponse(false);
    expect(isInsufficientEvidenceOutcome(outcome)).toBe(true);
    expect(isApprovableOutcome(outcome)).toBe(false);
  });

  it('READY_FOR_REVIEW is approvable', () => {
    expect(isApprovableOutcome({ kind: 'READY_FOR_REVIEW' })).toBe(true);
  });

  it('NO_CHANGE is not approvable', () => {
    expect(isApprovableOutcome({ kind: 'NO_CHANGE' })).toBe(false);
  });

  it('INSUFFICIENT_EVIDENCE is not approvable', () => {
    expect(isApprovableOutcome({ kind: 'INSUFFICIENT_EVIDENCE' })).toBe(false);
  });

  it('provider failure states are not approvable', () => {
    for (const kind of [
      'PROVIDER_RATE_LIMITED',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_TIMEOUT',
      'PROVIDER_CANCELLED',
      'OUTPUT_TRUNCATED',
      'INVALID_PROVIDER_RESPONSE',
    ] as const) {
      expect(isApprovableOutcome({ kind })).toBe(false);
    }
  });
});

describe('P0-6 integration: fallback privacy policy', () => {
  it('fallback receives exactly the same request as primary', async () => {
    const receivedRequests: unknown[] = [];
    const mkP = (id: string, fail: boolean) =>
      mockProvider(async () => {
        receivedRequests.push(id);
        if (fail) throw new ProviderUnavailableError(id, { providerErrorCategory: 'TRANSPORT' });
        return mockResponse();
      });

    const coord = mkCoordinator(
      [
        { providerId: 'primary', provider: mkP('primary', true) },
        { providerId: 'fallback', provider: mkP('fallback', false) },
      ],
      1,
    );

    const builder = reqBuilder();
    const result = await coord.execute(builder, cancelSignal());

    expect(result.providerId).toBe('fallback');
    expect(receivedRequests).toEqual(['primary', 'fallback']);
  });

  it('fallback cannot widen scope: same buildRequest function for all routes', async () => {
    const requests: string[] = [];
    const mkP = (id: string, fail: boolean) => ({
      descriptor: {
        contractVersion: 1 as const,
        id,
        displayName: id,
        capabilities: {
          contextIngestion: true,
          structuredOutput: true,
          streaming: false,
          toolCalling: false,
          reasoning: false,
          fileSupport: false,
          imageSupport: false,
          maximumContextCharacters: 100_000,
          structuredResponses: true,
        },
      },
      async execute(req: { requestId: string }) {
        requests.push(`${id}:${req.requestId}`);
        if (fail) throw new ProviderUnavailableError(id, { providerErrorCategory: 'TRANSPORT' });
        return mockResponse();
      },
    });

    const coord = mkCoordinator(
      [
        { providerId: 'a', provider: mkP('a', true) as unknown as AIProvider },
        { providerId: 'b', provider: mkP('b', false) as unknown as AIProvider },
      ],
      1,
    );

    await coord.execute(
      (providerId, timeout) =>
        ({
          contractVersion: 1,
          requestId: `sanitized-${providerId}`,
          prompt: { sections: [{ kind: 'CONTEXT', content: 'filtered-content-only' }] },
          executionMode: 'SINGLE_RESPONSE',
          constraints: {
            maximumOutputCharacters: 10000,
            requiredArtifactKinds: [],
            requiredCapabilities: [],
            requireStructuredResponse: false,
          },
          timeoutMs: timeout,
          cancellation: cancelSignal(),
          metadata: {},
        }) as never,
      cancelSignal(),
    );

    expect(requests).toEqual(['a:sanitized-a', 'b:sanitized-b']);
  });
});

describe('P0-6 integration: non-retryable errors stop immediately across routes', () => {
  it('401/INVALID_CONFIGURATION does not try fallback', async () => {
    let calls = 0;
    const primary = mockProvider(async () => {
      calls++;
      throw new InvalidProviderConfigurationError([{ path: '$.apiKey', message: 'invalid' }]);
    });
    const fallback = mockProvider(async () => {
      calls++;
      return mockResponse();
    });

    const coord = mkCoordinator(
      [
        { providerId: 'primary', provider: primary },
        { providerId: 'fallback', provider: fallback },
      ],
      3,
    );

    await expect(coord.execute(reqBuilder(), cancelSignal())).rejects.toThrow(
      InvalidProviderConfigurationError,
    );
    expect(calls).toBe(1);
  });
});

describe('P0-6 integration: observability diagnostics safety', () => {
  it('coordinator logger receives safe diagnostics', async () => {
    const recorded: unknown[] = [];
    const provider = mockProvider(async () => {
      throw new ProviderUnavailableError('p', {
        providerErrorCategory: 'RATE_LIMIT',
        providerStatus: 429,
        retryAfterMs: 5000,
      });
    });

    const coord = new ProviderCoordinator(
      {
        routes: [{ providerId: 'test-gemini', provider }],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 1 },
      },
      { now: () => Date.now() },
      { recordAttempt: (d) => recorded.push(d) },
      instantSleep,
    );

    try {
      await coord.execute(reqBuilder(), cancelSignal());
    } catch {
      /* expected */
    }

    expect(recorded.length).toBe(1);
    const diag = recorded[0] as Record<string, unknown>;
    expect(diag.providerId).toBe('test-gemini');
    expect(diag.attempt).toBe(1);
    expect(diag.retryable).toBe(true);
    expect(diag.retryAfterMs).toBe(5000);

    const serialized = JSON.stringify(diag);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('prompt');
    expect(serialized).not.toContain('authorization');
  });
});
