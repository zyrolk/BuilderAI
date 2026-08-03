export type ProviderErrorCategory = 'RATE_LIMIT' | 'UPSTREAM_5XX' | 'TRANSPORT' | 'UNKNOWN';

export interface ProviderUnavailableDiagnostics {
  readonly providerStatus?: number;
  readonly providerErrorCategory: ProviderErrorCategory;
  readonly providerErrorCode?: string;
  readonly sdkErrorName?: string;
  readonly retryAfterMs?: number;
}

export interface ProviderOutputTruncatedDiagnostics {
  readonly finishReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}
