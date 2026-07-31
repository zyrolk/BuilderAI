import type { AIProviderDescriptor, AIProviderRequest, AIProviderResponse } from '../types';

/**
 * Contract implemented by future provider adapters. Core services in this sprint never invoke it.
 */
export interface AIProvider {
  readonly descriptor: AIProviderDescriptor;
  execute(request: AIProviderRequest): Promise<AIProviderResponse>;
}
