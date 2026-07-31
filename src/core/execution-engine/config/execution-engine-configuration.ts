export interface ExecutionEngineConfiguration {
  readonly maximumRetries: number;
  readonly maximumTimeoutMs: number;
  readonly maximumRetryDelayMs: number;
  readonly maximumMetadataEntries: number;
}

export const DEFAULT_EXECUTION_ENGINE_CONFIGURATION: ExecutionEngineConfiguration = {
  maximumRetries: 5,
  maximumTimeoutMs: 300_000,
  maximumRetryDelayMs: 60_000,
  maximumMetadataEntries: 32,
};
