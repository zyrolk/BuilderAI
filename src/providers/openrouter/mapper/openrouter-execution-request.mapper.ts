import { AI_PROVIDER_CONTRACT_VERSION, type AIProviderRequest } from '../../../core/ai-provider';
import { ExecutionRequestValidator, type ExecutionRequest } from '../../../core/execution-engine';
import {
  TruncationRetryCompactionService,
  type TruncationRetryAttemptResolution,
} from '../../../core/prompt-orchestrator';
import type { OpenRouterProviderConfiguration } from '../types';

export class OpenRouterExecutionRequestMapper {
  private readonly validator: ExecutionRequestValidator = new ExecutionRequestValidator();
  private readonly compaction = new TruncationRetryCompactionService();

  map(
    request: ExecutionRequest,
    configuration: OpenRouterProviderConfiguration,
    attempt = 1,
    attemptTimeoutMs = Math.min(request.policy.timeout.durationMs, configuration.maximumTimeoutMs),
    attemptResolution: TruncationRetryAttemptResolution,
  ): AIProviderRequest {
    this.validator.validate(request);
    const baseMetadata = {
      ...request.metadata.values,
      'correlation-id': request.metadata.correlationId,
      attempt,
    };
    return {
      contractVersion: AI_PROVIDER_CONTRACT_VERSION,
      requestId: request.executionId,
      prompt: attemptResolution.prompt,
      executionMode: 'SINGLE_RESPONSE',
      constraints: {
        maximumOutputCharacters: configuration.maximumOutputCharacters,
        requiredArtifactKinds: ['STRUCTURED_DATA'],
        requiredCapabilities: ['CONTEXT_INGESTION', 'STRUCTURED_RESPONSES'],
        requireStructuredResponse: true,
      },
      timeoutMs: attemptTimeoutMs,
      cancellation: request.cancellation,
      metadata: this.compaction.appendAttemptMetadata(baseMetadata, attemptResolution),
    };
  }
}
