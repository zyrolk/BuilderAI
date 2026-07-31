import type { ProviderCapabilityName, ProviderExecutionMode } from '../types';

export interface AIProviderConfiguration {
  readonly providerId: string;
  readonly enabled: boolean;
  readonly priority: number;
  readonly defaultTimeoutMs: number;
  readonly maximumTimeoutMs: number;
  readonly allowedExecutionModes: readonly ProviderExecutionMode[];
  readonly requiredCapabilities: readonly ProviderCapabilityName[];
}
