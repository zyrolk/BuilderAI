export interface GeminiExecutionAttemptTelemetry {
  readonly correlationId: string;
  readonly attempt: number;
  readonly boundingActive: boolean;
  readonly compactionActive: boolean;
  readonly allowlistCount: number;
  readonly attemptTimeoutMs: number;
  readonly durationMs: number;
  readonly outcome: 'SUCCEEDED' | 'FAILED';
  readonly errorCode?: string;
  readonly finishReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly providerStatus?: number;
  readonly providerErrorCategory?: 'RATE_LIMIT' | 'UPSTREAM_5XX' | 'TRANSPORT' | 'UNKNOWN';
  readonly providerErrorCode?: string;
  readonly sdkErrorName?: string;
  readonly retryAfterMs?: number;
}

export interface GeminiExecutionAttemptLogger {
  recordAttempt(event: GeminiExecutionAttemptTelemetry): void;
}
