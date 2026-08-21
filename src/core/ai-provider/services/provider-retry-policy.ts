import type { AIProviderErrorCode } from '../types/ai-provider-error';
import type { ProviderErrorCategory } from '../types/provider-error-diagnostics';

export type ProviderFailureClassification = 'RETRYABLE' | 'NON_RETRYABLE';

export interface ProviderRetryConfiguration {
  readonly maximumAttempts: number;
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly jitterFraction: number;
  readonly stageDeadlineMs: number;
}

export const DEFAULT_PROVIDER_RETRY_CONFIGURATION: ProviderRetryConfiguration = {
  maximumAttempts: 3,
  baseDelayMs: 1_000,
  maximumDelayMs: 30_000,
  jitterFraction: 0.25,
  stageDeadlineMs: 120_000,
};

const RETRYABLE_ERROR_CODES: ReadonlySet<AIProviderErrorCode> = new Set([
  'PROVIDER_UNAVAILABLE',
  'OUTPUT_TRUNCATED',
]);

const RETRYABLE_ERROR_CATEGORIES: ReadonlySet<ProviderErrorCategory> = new Set([
  'RATE_LIMIT',
  'UPSTREAM_5XX',
  'TRANSPORT',
]);

const NON_RETRYABLE_ERROR_CODES: ReadonlySet<AIProviderErrorCode> = new Set([
  'INVALID_CONFIGURATION',
  'UNSUPPORTED_CAPABILITY',
  'CONTRACT_VIOLATION',
  'CANCELLED',
]);

export function classifyProviderFailure(
  errorCode: AIProviderErrorCode,
  errorCategory?: ProviderErrorCategory,
): ProviderFailureClassification {
  if (NON_RETRYABLE_ERROR_CODES.has(errorCode)) return 'NON_RETRYABLE';
  if (RETRYABLE_ERROR_CODES.has(errorCode)) return 'RETRYABLE';
  if (errorCategory !== undefined && RETRYABLE_ERROR_CATEGORIES.has(errorCategory)) {
    return 'RETRYABLE';
  }
  return 'NON_RETRYABLE';
}

export interface RetryDelayResult {
  readonly delayMs: number;
  readonly withinDeadline: boolean;
}

/**
 * Exponential backoff with bounded jitter. Deterministic when `jitterSeed` is provided
 * (for testing); random otherwise.
 */
export function calculateRetryDelay(
  attempt: number,
  configuration: ProviderRetryConfiguration,
  retryAfterMs: number | undefined,
  elapsedMs: number,
  jitterSeed?: number,
): RetryDelayResult {
  const remainingMs = Math.max(0, configuration.stageDeadlineMs - elapsedMs);

  let baseDelay: number;
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    baseDelay = Math.min(retryAfterMs, configuration.maximumDelayMs);
  } else {
    const exponent = Math.max(0, attempt - 1);
    baseDelay = Math.min(configuration.baseDelayMs * 2 ** exponent, configuration.maximumDelayMs);
  }

  const jitterRange = baseDelay * configuration.jitterFraction;
  const jitterValue = jitterRange * (jitterSeed ?? Math.random());
  const delayMs = Math.round(baseDelay + jitterValue);

  if (delayMs > remainingMs) {
    return { delayMs, withinDeadline: false };
  }
  return { delayMs, withinDeadline: true };
}

export interface ProviderAttemptDiagnostics {
  readonly providerId: string;
  readonly model?: string;
  readonly attempt: number;
  readonly failureClassification: ProviderFailureClassification;
  readonly errorCode: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly fallbackAttempted: boolean;
  readonly terminalState: string;
}
