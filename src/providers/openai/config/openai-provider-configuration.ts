import type { AIProviderConfiguration } from '../../../core/ai-provider';
import type { OpenAIProviderConfiguration } from '../types';
import { OPENAI_PROVIDER_ID } from '../types';

export function toCoreProviderConfiguration(
  configuration: OpenAIProviderConfiguration,
): AIProviderConfiguration {
  return {
    providerId: OPENAI_PROVIDER_ID,
    enabled: true,
    priority: 0,
    defaultTimeoutMs: configuration.defaultTimeoutMs,
    maximumTimeoutMs: configuration.maximumTimeoutMs,
    allowedExecutionModes: ['SINGLE_RESPONSE'],
    requiredCapabilities: ['CONTEXT_INGESTION', 'STRUCTURED_RESPONSES'],
  };
}
