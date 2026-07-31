import type { AIProviderConfiguration } from '../config';
import {
  type AIProviderDescriptor,
  type AIProviderRequest,
  type ProviderCapabilityName,
  UnsupportedCapabilityError,
} from '../types';

export type ProviderIncompatibilityReason =
  'CONTEXT_LIMIT_EXCEEDED' | 'DISABLED' | 'EXECUTION_MODE_NOT_ALLOWED' | 'TIMEOUT_LIMIT_EXCEEDED';

export interface ProviderCompatibilityResult {
  readonly compatible: boolean;
  readonly missingCapabilities: readonly ProviderCapabilityName[];
  readonly reasons: readonly ProviderIncompatibilityReason[];
}

const CAPABILITY_ACCESSORS: Readonly<
  Record<ProviderCapabilityName, (descriptor: AIProviderDescriptor) => boolean>
> = {
  CONTEXT_INGESTION: ({ capabilities }) => capabilities.contextIngestion,
  STRUCTURED_OUTPUT: ({ capabilities }) => capabilities.structuredOutput,
  STREAMING: ({ capabilities }) => capabilities.streaming,
  TOOL_CALLING: ({ capabilities }) => capabilities.toolCalling,
  REASONING: ({ capabilities }) => capabilities.reasoning,
  FILE_SUPPORT: ({ capabilities }) => capabilities.fileSupport,
  IMAGE_SUPPORT: ({ capabilities }) => capabilities.imageSupport,
  STRUCTURED_RESPONSES: ({ capabilities }) => capabilities.structuredResponses,
};

export class ProviderCompatibilityService {
  evaluate(
    descriptor: AIProviderDescriptor,
    configuration: AIProviderConfiguration,
    request: AIProviderRequest,
  ): ProviderCompatibilityResult {
    const required = requiredCapabilities(configuration, request);
    const missingCapabilities = required.filter(
      (capability) => !CAPABILITY_ACCESSORS[capability](descriptor),
    );
    const reasons: ProviderIncompatibilityReason[] = [];

    if (!configuration.enabled) reasons.push('DISABLED');
    if (!configuration.allowedExecutionModes.includes(request.executionMode)) {
      reasons.push('EXECUTION_MODE_NOT_ALLOWED');
    }
    if (request.timeoutMs > configuration.maximumTimeoutMs) {
      reasons.push('TIMEOUT_LIMIT_EXCEEDED');
    }
    if (request.prompt.budget.characters > descriptor.capabilities.maximumContextCharacters) {
      reasons.push('CONTEXT_LIMIT_EXCEEDED');
    }

    return {
      compatible: missingCapabilities.length === 0 && reasons.length === 0,
      missingCapabilities,
      reasons,
    };
  }

  assertCapabilities(
    descriptor: AIProviderDescriptor,
    configuration: AIProviderConfiguration,
    request: AIProviderRequest,
  ): void {
    const result = this.evaluate(descriptor, configuration, request);
    if (result.missingCapabilities.length > 0) {
      throw new UnsupportedCapabilityError(descriptor.id, result.missingCapabilities);
    }
  }
}

function requiredCapabilities(
  configuration: AIProviderConfiguration,
  request: AIProviderRequest,
): readonly ProviderCapabilityName[] {
  const required = new Set<ProviderCapabilityName>([
    'CONTEXT_INGESTION',
    ...configuration.requiredCapabilities,
    ...request.constraints.requiredCapabilities,
  ]);
  if (request.executionMode === 'STREAMING') required.add('STREAMING');
  if (request.constraints.requireStructuredResponse) required.add('STRUCTURED_RESPONSES');
  for (const kind of request.constraints.requiredArtifactKinds) {
    if (kind === 'STRUCTURED_DATA') required.add('STRUCTURED_OUTPUT');
    if (kind === 'FILE') required.add('FILE_SUPPORT');
    if (kind === 'IMAGE') required.add('IMAGE_SUPPORT');
  }
  return [...required];
}
