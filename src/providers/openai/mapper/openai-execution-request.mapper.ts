import { AI_PROVIDER_CONTRACT_VERSION, type AIProviderRequest } from '../../../core/ai-provider';
import { ExecutionRequestValidator, type ExecutionRequest } from '../../../core/execution-engine';
import type { OpenAIProviderConfiguration } from '../types';

export class OpenAIExecutionRequestMapper {
  private readonly validator: ExecutionRequestValidator = new ExecutionRequestValidator();

  map(
    request: ExecutionRequest,
    configuration: OpenAIProviderConfiguration,
    attempt = 1,
  ): AIProviderRequest {
    this.validator.validate(request);
    return {
      contractVersion: AI_PROVIDER_CONTRACT_VERSION,
      requestId: request.executionId,
      prompt: request.prompt,
      executionMode: 'SINGLE_RESPONSE',
      constraints: {
        maximumOutputCharacters: configuration.maximumOutputCharacters,
        requiredArtifactKinds: ['STRUCTURED_DATA'],
        requiredCapabilities: ['CONTEXT_INGESTION', 'STRUCTURED_RESPONSES'],
        requireStructuredResponse: true,
      },
      timeoutMs: Math.min(request.policy.timeout.durationMs, configuration.maximumTimeoutMs),
      cancellation: request.cancellation,
      metadata: {
        ...request.metadata.values,
        'correlation-id': request.metadata.correlationId,
        attempt,
      },
    };
  }
}
