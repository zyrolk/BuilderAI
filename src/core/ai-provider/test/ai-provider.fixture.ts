import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import { PromptOrchestratorService } from '../../prompt-orchestrator';
import type { AIProviderConfiguration } from '../config';
import type { AIProvider } from '../ports';
import type {
  AIProviderCapabilities,
  AIProviderDescriptor,
  AIProviderRequest,
  AIProviderResponse,
} from '../types';

export function createCapabilities(
  overrides: Partial<AIProviderCapabilities> = {},
): AIProviderCapabilities {
  return {
    contextIngestion: true,
    structuredOutput: true,
    streaming: false,
    toolCalling: false,
    reasoning: true,
    fileSupport: true,
    imageSupport: false,
    maximumContextCharacters: 100_000,
    structuredResponses: true,
    ...overrides,
  };
}

export function createDescriptor(
  id = 'provider-alpha',
  capabilityOverrides: Partial<AIProviderCapabilities> = {},
): AIProviderDescriptor {
  return {
    contractVersion: 1,
    id,
    displayName: id,
    capabilities: createCapabilities(capabilityOverrides),
  };
}

export function createConfiguration(
  providerId = 'provider-alpha',
  overrides: Partial<AIProviderConfiguration> = {},
): AIProviderConfiguration {
  return {
    providerId,
    enabled: true,
    priority: 10,
    defaultTimeoutMs: 1_000,
    maximumTimeoutMs: 5_000,
    allowedExecutionModes: ['SINGLE_RESPONSE'],
    requiredCapabilities: ['CONTEXT_INGESTION'],
    ...overrides,
  };
}

export function createProvider(descriptor = createDescriptor()): AIProvider {
  return {
    descriptor,
    execute: async () => {
      throw new Error('Test provider execution is intentionally unavailable.');
    },
  };
}

export async function createRequest(
  overrides: Partial<AIProviderRequest> = {},
): Promise<AIProviderRequest> {
  const context = await new ContextBuilderService().build(await createContextInput());
  const prompt = await new PromptOrchestratorService().build({ context });
  return {
    contractVersion: 1,
    requestId: 'request-one',
    prompt,
    executionMode: 'SINGLE_RESPONSE',
    constraints: {
      maximumOutputCharacters: 20_000,
      requiredArtifactKinds: ['TEXT'],
      requiredCapabilities: [],
      requireStructuredResponse: true,
    },
    timeoutMs: 1_000,
    cancellation: { cancelled: false, subscribe: () => () => undefined },
    metadata: { purpose: 'contract-test', attempt: 1 },
    ...overrides,
  };
}

export function createResponse(overrides: Partial<AIProviderResponse> = {}): AIProviderResponse {
  return {
    contractVersion: 1,
    requestId: 'request-one',
    status: 'COMPLETED',
    artifacts: [{ id: 'artifact-one', name: 'summary', kind: 'TEXT', content: 'result' }],
    diagnostics: [],
    warnings: [],
    statistics: {
      startedAt: '2026-07-30T16:00:00.000Z',
      completedAt: '2026-07-30T16:00:01.000Z',
      durationMs: 1_000,
    },
    usage: {
      inputCharacters: 1_000,
      promptCharacters: 900,
      outputCharacters: 6,
      artifactCount: 1,
    },
    metadata: { trace: 'local-contract-test' },
    ...overrides,
  };
}
