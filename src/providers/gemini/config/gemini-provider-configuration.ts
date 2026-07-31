import type { AIProviderConfiguration } from '../../../core/ai-provider';
import { GEMINI_PROVIDER_ID, type GeminiProviderConfiguration } from '../types';

export function toCoreProviderConfiguration(
  configuration: GeminiProviderConfiguration,
): AIProviderConfiguration {
  return {
    providerId: GEMINI_PROVIDER_ID,
    enabled: true,
    priority: 0,
    defaultTimeoutMs: configuration.defaultTimeoutMs,
    maximumTimeoutMs: configuration.maximumTimeoutMs,
    allowedExecutionModes: ['SINGLE_RESPONSE'],
    requiredCapabilities: ['CONTEXT_INGESTION', 'STRUCTURED_RESPONSES'],
  };
}
