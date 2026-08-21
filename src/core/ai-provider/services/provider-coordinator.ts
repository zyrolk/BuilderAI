import type { AIProvider } from '../ports/ai-provider';
import type {
  AIProviderRequest,
  AIProviderResponse,
  ProviderCancellationSignal,
} from '../types/ai-provider';
import {
  AIProviderError,
  ProviderCancelledError,
  ProviderUnavailableError,
} from '../types/ai-provider-error';
import type { ProviderUnavailableDiagnostics } from '../types/provider-error-diagnostics';
import {
  calculateRetryDelay,
  classifyProviderFailure,
  type ProviderAttemptDiagnostics,
  type ProviderRetryConfiguration,
  DEFAULT_PROVIDER_RETRY_CONFIGURATION,
} from './provider-retry-policy';

export interface ProviderRoute {
  readonly providerId: string;
  readonly provider: AIProvider;
}

export interface ProviderCoordinatorConfiguration {
  readonly retry: ProviderRetryConfiguration;
  readonly routes: readonly ProviderRoute[];
  /** When set, elapsed stage time is measured from this absolute timestamp. */
  readonly deadlineAnchorMs?: number;
}

export interface ProviderCoordinatorClock {
  now(): number;
}

export interface ProviderCoordinatorLogger {
  recordAttempt(diagnostics: ProviderAttemptDiagnostics): void;
}

export type SleepFunction = (ms: number, signal: ProviderCancellationSignal) => Promise<boolean>;

export interface ProviderCoordinationResult {
  readonly response: AIProviderResponse;
  readonly providerId: string;
  readonly totalAttempts: number;
  readonly fallbackUsed: boolean;
}

/**
 * Provider-neutral retry/fallback coordinator. No provider-specific logic.
 *
 * Enforces:
 * - One global deadline per workflow stage
 * - Exponential backoff with jitter and Retry-After support
 * - Cancellation propagation into retry delays
 * - Fallback only for retryable failures before a valid response
 * - No nested retry explosion (single attempt budget)
 */
export class ProviderCoordinator {
  private readonly retryConfig: ProviderRetryConfiguration;
  private readonly routes: readonly ProviderRoute[];
  private readonly deadlineAnchorMs?: number;

  constructor(
    configuration: Partial<ProviderCoordinatorConfiguration> & { routes: readonly ProviderRoute[] },
    private readonly clock: ProviderCoordinatorClock = { now: () => Date.now() },
    private readonly logger?: ProviderCoordinatorLogger,
    private readonly sleep: SleepFunction = defaultSleep,
  ) {
    this.retryConfig = { ...DEFAULT_PROVIDER_RETRY_CONFIGURATION, ...configuration.retry };
    this.routes = configuration.routes;
    this.deadlineAnchorMs = configuration.deadlineAnchorMs;
    if (this.routes.length === 0) {
      throw new Error('At least one provider route is required.');
    }
  }

  async execute(
    buildRequest: (providerId: string, timeoutMs: number) => AIProviderRequest,
    cancellation: ProviderCancellationSignal,
  ): Promise<ProviderCoordinationResult> {
    const stageStart = this.deadlineAnchorMs ?? this.clock.now();
    let totalAttempts = 0;
    let lastError: unknown;

    for (let routeIndex = 0; routeIndex < this.routes.length; routeIndex++) {
      const route = this.routes[routeIndex]!;
      const fallbackUsed = routeIndex > 0;

      for (let attempt = 1; attempt <= this.retryConfig.maximumAttempts; attempt++) {
        if (cancellation.cancelled) {
          throw new ProviderCancelledError('coordinator', cancellation.reason);
        }

        const elapsedMs = this.clock.now() - stageStart;
        const remainingMs = Math.max(0, this.retryConfig.stageDeadlineMs - elapsedMs);
        if (remainingMs <= 0) {
          throw lastError instanceof Error
            ? lastError
            : new ProviderUnavailableError(route.providerId, {
                providerErrorCategory: 'UNKNOWN',
              });
        }

        totalAttempts++;
        const attemptTimeoutMs = Math.min(remainingMs, this.retryConfig.stageDeadlineMs);
        const request = buildRequest(route.providerId, attemptTimeoutMs);

        try {
          const response = await route.provider.execute(request);
          return { response, providerId: route.providerId, totalAttempts, fallbackUsed };
        } catch (error: unknown) {
          lastError = error;

          const errorCode =
            error instanceof AIProviderError ? error.code : 'UNKNOWN_PROVIDER_ERROR';
          const diagnosticsObj =
            error instanceof ProviderUnavailableError ? error.diagnostics : undefined;
          const classification = classifyProviderFailure(
            errorCode as Parameters<typeof classifyProviderFailure>[0],
            diagnosticsObj?.providerErrorCategory,
          );

          const nowMs = this.clock.now();
          const currentElapsed = nowMs - stageStart;

          this.logger?.recordAttempt({
            providerId: route.providerId,
            attempt,
            failureClassification: classification,
            errorCode,
            retryable: classification === 'RETRYABLE',
            retryAfterMs: diagnosticsObj?.retryAfterMs,
            elapsedMs: currentElapsed,
            remainingMs: Math.max(0, this.retryConfig.stageDeadlineMs - currentElapsed),
            fallbackAttempted: fallbackUsed,
            terminalState: classification === 'NON_RETRYABLE' ? 'FAILED' : 'RETRYING',
          });

          if (classification === 'NON_RETRYABLE') {
            throw error;
          }

          if (attempt < this.retryConfig.maximumAttempts) {
            const delay = calculateRetryDelay(
              attempt,
              this.retryConfig,
              diagnosticsObj?.retryAfterMs,
              currentElapsed,
            );

            if (!delay.withinDeadline) {
              if (isRateLimitError(diagnosticsObj)) {
                throw new ProviderUnavailableError(route.providerId, {
                  providerErrorCategory: 'RATE_LIMIT',
                  retryAfterMs: diagnosticsObj?.retryAfterMs,
                });
              }
              break;
            }

            const cancelled = await this.sleep(delay.delayMs, cancellation);
            if (cancelled) {
              throw new ProviderCancelledError('coordinator', cancellation.reason);
            }
          }
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ProviderUnavailableError('coordinator', { providerErrorCategory: 'UNKNOWN' });
  }
}

function isRateLimitError(diagnostics?: ProviderUnavailableDiagnostics): boolean {
  return diagnostics?.providerErrorCategory === 'RATE_LIMIT';
}

function defaultSleep(ms: number, signal: ProviderCancellationSignal): Promise<boolean> {
  if (signal.cancelled) return Promise.resolve(true);
  if (ms <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, ms);
    unsubscribe = signal.subscribe(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
