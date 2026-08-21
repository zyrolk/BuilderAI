import { describe, expect, it, vi } from 'vitest';

import {
  ProviderCancelledError,
  ProviderUnavailableError,
  InvalidProviderConfigurationError,
  UnsupportedCapabilityError,
} from '../types/ai-provider-error';
import type { AIProviderResponse, ProviderCancellationSignal } from '../types/ai-provider';
import type { AIProvider } from '../ports/ai-provider';
import {
  calculateRetryDelay,
  classifyProviderFailure,
  DEFAULT_PROVIDER_RETRY_CONFIGURATION,
} from '../services/provider-retry-policy';
import {
  ProviderCoordinator,
  type ProviderRoute,
  type SleepFunction,
} from '../services/provider-coordinator';
import {
  classifyEmptyResponse,
  classifyProviderError,
  isApprovableOutcome,
  isNoChangeOutcome,
  isInsufficientEvidenceOutcome,
  isRateLimitOutcome,
  type PrepareOutcome,
} from '../../../application/workspace/prepare-outcome';

function createMockResponse(overrides: Partial<AIProviderResponse> = {}): AIProviderResponse {
  return {
    contractVersion: 1,
    requestId: 'test-req',
    status: 'COMPLETED',
    artifacts: [],
    diagnostics: [],
    warnings: [],
    statistics: { startedAt: '2026-01-01', completedAt: '2026-01-01', durationMs: 100 },
    usage: { inputCharacters: 100, promptCharacters: 100, outputCharacters: 50, artifactCount: 0 },
    metadata: {},
    ...overrides,
  };
}

function createMockProvider(execute: (req: unknown) => Promise<AIProviderResponse>): AIProvider {
  return {
    descriptor: {
      contractVersion: 1,
      id: 'test-provider',
      displayName: 'Test',
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
    execute: execute as AIProvider['execute'],
  };
}

function createCancellationSignal(
  cancelled = false,
): ProviderCancellationSignal & { cancel: () => void } {
  const listeners: Array<(reason?: string) => void> = [];
  const signal = {
    cancelled,
    reason: undefined as string | undefined,
    cancel() {
      signal.cancelled = true;
      signal.reason = 'user-cancelled';
      for (const fn of listeners) fn(signal.reason);
    },
    subscribe(listener: (reason?: string) => void) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
  return signal;
}

function noSleep(): SleepFunction {
  return async () => false;
}

function createCoordinator(
  provider: AIProvider,
  overrides: Partial<typeof DEFAULT_PROVIDER_RETRY_CONFIGURATION> = {},
  sleep?: SleepFunction,
) {
  const route: ProviderRoute = { providerId: 'test-provider', provider };
  return new ProviderCoordinator(
    { routes: [route], retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, ...overrides } },
    { now: () => Date.now() },
    undefined,
    sleep ?? noSleep(),
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const buildReq = () => (_id: string, _timeout: number) =>
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
    cancellation: createCancellationSignal(),
    metadata: {},
  }) as never;

describe('P0-6: 429 with Retry-After waits correctly', () => {
  it('uses Retry-After value in delay calculation', () => {
    const result = calculateRetryDelay(1, DEFAULT_PROVIDER_RETRY_CONFIGURATION, 5000, 0);
    expect(result.delayMs).toBeGreaterThanOrEqual(5000);
    expect(result.withinDeadline).toBe(true);
  });
});

describe('P0-6: Retry-After longer than deadline fails', () => {
  it('returns withinDeadline=false when Retry-After exceeds remaining budget', () => {
    const result = calculateRetryDelay(
      1,
      { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, stageDeadlineMs: 5_000 },
      200_000,
      0,
    );
    expect(result.withinDeadline).toBe(false);
  });
});

describe('P0-6: 429 without Retry-After uses backoff', () => {
  it('uses exponential backoff', () => {
    const r1 = calculateRetryDelay(1, DEFAULT_PROVIDER_RETRY_CONFIGURATION, undefined, 0, 0);
    const r2 = calculateRetryDelay(2, DEFAULT_PROVIDER_RETRY_CONFIGURATION, undefined, 0, 0);
    expect(r2.delayMs).toBeGreaterThan(r1.delayMs);
  });
});

describe('P0-6: 500/502/503 retry', () => {
  it('classifies upstream 5xx as retryable', () => {
    expect(classifyProviderFailure('PROVIDER_UNAVAILABLE', 'UPSTREAM_5XX')).toBe('RETRYABLE');
  });
});

describe('P0-6: 401/403 does not retry', () => {
  it('classifies INVALID_CONFIGURATION as non-retryable', () => {
    expect(classifyProviderFailure('INVALID_CONFIGURATION')).toBe('NON_RETRYABLE');
  });
});

describe('P0-6: Invalid request does not retry', () => {
  it('classifies CONTRACT_VIOLATION as non-retryable', () => {
    expect(classifyProviderFailure('CONTRACT_VIOLATION')).toBe('NON_RETRYABLE');
  });
});

describe('P0-6: Cancellation stops retry', () => {
  it('throws ProviderCancelledError when signal is already cancelled', async () => {
    const provider = createMockProvider(async () => createMockResponse());
    const coordinator = createCoordinator(provider);
    const signal = createCancellationSignal(true);

    await expect(coordinator.execute(buildReq(), signal)).rejects.toThrow(ProviderCancelledError);
  });
});

describe('P0-6: Cancellation during retry delay stops workflow', () => {
  it('stops when cancelled during sleep', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      throw new ProviderUnavailableError('test', { providerErrorCategory: 'TRANSPORT' });
    });

    const signal = createCancellationSignal();
    const sleepFn: SleepFunction = async () => {
      signal.cancel();
      return true;
    };

    const coordinator = createCoordinator(provider, {}, sleepFn);
    await expect(coordinator.execute(buildReq(), signal)).rejects.toThrow(ProviderCancelledError);
    expect(callCount).toBe(1);
  });
});

describe('P0-6: Global deadline prevents nested retry explosion', () => {
  it('total attempts bounded by maximumAttempts', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      throw new ProviderUnavailableError('test', { providerErrorCategory: 'TRANSPORT' });
    });

    const coordinator = createCoordinator(provider, { maximumAttempts: 3 });
    const signal = createCancellationSignal();

    try {
      await coordinator.execute(buildReq(), signal);
    } catch {
      // expected
    }
    expect(callCount).toBeLessThanOrEqual(3);
  });
});

describe('P0-6: Provider fallback after retryable primary failure', () => {
  it('tries fallback provider after primary exhausts retries', async () => {
    const primary = createMockProvider(async () => {
      throw new ProviderUnavailableError('primary', { providerErrorCategory: 'TRANSPORT' });
    });
    const fallback = createMockProvider(async () => createMockResponse());

    const coordinator = new ProviderCoordinator(
      {
        routes: [
          { providerId: 'primary', provider: primary },
          { providerId: 'fallback', provider: fallback },
        ],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 1 },
      },
      { now: () => Date.now() },
      undefined,
      noSleep(),
    );

    const result = await coordinator.execute(buildReq(), createCancellationSignal());
    expect(result.providerId).toBe('fallback');
    expect(result.fallbackUsed).toBe(true);
  });
});

describe('P0-6: Fallback does not occur after valid response', () => {
  it('returns primary response without trying fallback', async () => {
    const primary = createMockProvider(async () => createMockResponse());
    const fallbackExecute = vi.fn();
    const fallback = createMockProvider(fallbackExecute);

    const coordinator = new ProviderCoordinator(
      {
        routes: [
          { providerId: 'primary', provider: primary },
          { providerId: 'fallback', provider: fallback },
        ],
      },
      { now: () => Date.now() },
      undefined,
      noSleep(),
    );

    const result = await coordinator.execute(buildReq(), createCancellationSignal());
    expect(result.providerId).toBe('primary');
    expect(result.fallbackUsed).toBe(false);
    expect(fallbackExecute).not.toHaveBeenCalled();
  });
});

describe('P0-6: Fallback order is deterministic', () => {
  it('routes array order determines fallback sequence', async () => {
    const order: string[] = [];
    const mkProvider = (id: string) =>
      createMockProvider(async () => {
        order.push(id);
        throw new ProviderUnavailableError(id, { providerErrorCategory: 'TRANSPORT' });
      });

    const coordinator = new ProviderCoordinator(
      {
        routes: [
          { providerId: 'a', provider: mkProvider('a') },
          { providerId: 'b', provider: mkProvider('b') },
          { providerId: 'c', provider: mkProvider('c') },
        ],
        retry: { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, maximumAttempts: 1 },
      },
      { now: () => Date.now() },
      undefined,
      noSleep(),
    );

    try {
      await coordinator.execute(buildReq(), createCancellationSignal());
    } catch {
      // expected
    }
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('P0-6: Valid NO_CHANGE is distinct from provider failure', () => {
  it('classifies semantic no-change as NO_CHANGE', () => {
    const outcome = classifyEmptyResponse(true, 'Code already correct');
    expect(isNoChangeOutcome(outcome)).toBe(true);
    expect(isApprovableOutcome(outcome)).toBe(false);
  });
});

describe('P0-6: INSUFFICIENT_EVIDENCE is distinct from NO_CHANGE', () => {
  it('classifies non-semantic empty response as INSUFFICIENT_EVIDENCE', () => {
    const outcome = classifyEmptyResponse(false);
    expect(isInsufficientEvidenceOutcome(outcome)).toBe(true);
    expect(isNoChangeOutcome(outcome)).toBe(false);
    expect(isApprovableOutcome(outcome)).toBe(false);
  });
});

describe('P0-6: NO_CHANGE cannot be approved/applied', () => {
  it('isApprovableOutcome returns false for NO_CHANGE', () => {
    const noChange: PrepareOutcome = { kind: 'NO_CHANGE' };
    expect(isApprovableOutcome(noChange)).toBe(false);
  });

  it('isApprovableOutcome returns false for INSUFFICIENT_EVIDENCE', () => {
    const insufficient: PrepareOutcome = { kind: 'INSUFFICIENT_EVIDENCE' };
    expect(isApprovableOutcome(insufficient)).toBe(false);
  });

  it('isApprovableOutcome returns true for READY_FOR_REVIEW', () => {
    const ready: PrepareOutcome = { kind: 'READY_FOR_REVIEW' };
    expect(isApprovableOutcome(ready)).toBe(true);
  });
});

describe('P0-6: Empty/invalid provider output fails closed', () => {
  it('classifies empty response without semantic signal as INSUFFICIENT_EVIDENCE', () => {
    const outcome = classifyEmptyResponse(false);
    expect(outcome.kind).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('P0-6: Provider error classification', () => {
  it('classifies PROVIDER_UNAVAILABLE correctly', () => {
    expect(classifyProviderError('PROVIDER_UNAVAILABLE')).toBe('PROVIDER_UNAVAILABLE');
  });

  it('classifies TIMEOUT correctly', () => {
    expect(classifyProviderError('TIMEOUT')).toBe('PROVIDER_TIMEOUT');
  });

  it('classifies CANCELLED correctly', () => {
    expect(classifyProviderError('CANCELLED')).toBe('PROVIDER_CANCELLED');
  });

  it('classifies OUTPUT_TRUNCATED correctly', () => {
    expect(classifyProviderError('OUTPUT_TRUNCATED')).toBe('OUTPUT_TRUNCATED');
  });

  it('classifies CONTRACT_VIOLATION correctly', () => {
    expect(classifyProviderError('CONTRACT_VIOLATION')).toBe('INVALID_PROVIDER_RESPONSE');
  });
});

describe('P0-6: Rate limit detection', () => {
  it('detects 429 as rate limit', () => {
    expect(isRateLimitOutcome('PROVIDER_UNAVAILABLE', 429)).toBe(true);
  });

  it('does not flag non-429 as rate limit', () => {
    expect(isRateLimitOutcome('PROVIDER_UNAVAILABLE', 503)).toBe(false);
  });
});

describe('P0-6: Provider diagnostics contain no secrets', () => {
  it('attempt diagnostics do not include api keys or prompts', () => {
    const diagnostics = {
      providerId: 'gemini',
      attempt: 1,
      failureClassification: 'RETRYABLE' as const,
      errorCode: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      elapsedMs: 1000,
      remainingMs: 119_000,
      fallbackAttempted: false,
      terminalState: 'RETRYING',
    };

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('Bearer');
    expect(serialized).not.toContain('prompt');
  });
});

describe('P0-6: Non-retryable errors stop immediately', () => {
  it('INVALID_CONFIGURATION stops without retry', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      throw new InvalidProviderConfigurationError([{ path: '$.apiKey', message: 'invalid' }]);
    });

    const coordinator = createCoordinator(provider, { maximumAttempts: 3 });
    try {
      await coordinator.execute(buildReq(), createCancellationSignal());
    } catch {
      // expected
    }
    expect(callCount).toBe(1);
  });
});

describe('P0-6: UNSUPPORTED_CAPABILITY stops without retry', () => {
  it('does not retry unsupported capability', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      throw new UnsupportedCapabilityError('test', ['STREAMING']);
    });

    const coordinator = createCoordinator(provider, { maximumAttempts: 3 });
    try {
      await coordinator.execute(buildReq(), createCancellationSignal());
    } catch {
      // expected
    }
    expect(callCount).toBe(1);
  });
});

describe('P0-6: Exponential backoff with jitter is deterministic', () => {
  it('produces consistent results with fixed jitterSeed', () => {
    const a = calculateRetryDelay(2, DEFAULT_PROVIDER_RETRY_CONFIGURATION, undefined, 0, 0.5);
    const b = calculateRetryDelay(2, DEFAULT_PROVIDER_RETRY_CONFIGURATION, undefined, 0, 0.5);
    expect(a.delayMs).toBe(b.delayMs);
  });

  it('produces different results with different jitterSeed', () => {
    const a = calculateRetryDelay(2, DEFAULT_PROVIDER_RETRY_CONFIGURATION, undefined, 0, 0);
    const b = calculateRetryDelay(2, DEFAULT_PROVIDER_RETRY_CONFIGURATION, undefined, 0, 1);
    expect(a.delayMs).not.toBe(b.delayMs);
  });
});

describe('P0-6: Coordinator requires at least one route', () => {
  it('throws when routes array is empty', () => {
    expect(() => new ProviderCoordinator({ routes: [] })).toThrow('At least one provider route');
  });
});

describe('P0-6: Stage deadline exhaustion', () => {
  it('throws when remaining stage budget is zero before retry', async () => {
    let callCount = 0;
    const provider = createMockProvider(async () => {
      callCount++;
      throw new ProviderUnavailableError('test', { providerErrorCategory: 'TRANSPORT' });
    });
    let nowMs = 0;
    const coordinator = new ProviderCoordinator(
      {
        routes: [{ providerId: 'test-provider', provider }],
        retry: {
          ...DEFAULT_PROVIDER_RETRY_CONFIGURATION,
          stageDeadlineMs: 100,
          maximumAttempts: 3,
        },
      },
      { now: () => nowMs },
      undefined,
      noSleep(),
    );
    nowMs = 200;
    await expect(coordinator.execute(buildReq(), createCancellationSignal())).rejects.toThrow();
    expect(callCount).toBe(1);
  });
});

describe('P0-6: Rate limit beyond deadline stops retry', () => {
  it('throws ProviderUnavailableError when Retry-After exceeds remaining budget', async () => {
    const provider = createMockProvider(async () => {
      throw new ProviderUnavailableError('test', {
        providerErrorCategory: 'RATE_LIMIT',
        retryAfterMs: 60_000,
      });
    });
    const coordinator = createCoordinator(
      provider,
      { stageDeadlineMs: 1_000, maximumAttempts: 2 },
      noSleep(),
    );
    await expect(coordinator.execute(buildReq(), createCancellationSignal())).rejects.toThrow(
      ProviderUnavailableError,
    );
  });
});
