import type { AIProviderConfiguration } from '../../../core/ai-provider';
import type { OpenRouterProviderConfiguration } from '../types';
import { OPENROUTER_PROVIDER_ID } from '../types';

export function toCoreProviderConfiguration(
  configuration: OpenRouterProviderConfiguration,
): AIProviderConfiguration {
  return {
    providerId: OPENROUTER_PROVIDER_ID,
    enabled: true,
    priority: 0,
    defaultTimeoutMs: configuration.defaultTimeoutMs,
    maximumTimeoutMs: configuration.maximumTimeoutMs,
    allowedExecutionModes: ['SINGLE_RESPONSE'],
    requiredCapabilities: ['CONTEXT_INGESTION', 'STRUCTURED_RESPONSES'],
  };
}
