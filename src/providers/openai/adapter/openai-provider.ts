import {
  AI_PROVIDER_CONTRACT_VERSION,
  ProviderCancelledError,
  ProviderContractService,
  type AIProvider,
  type AIProviderDescriptor,
  type AIProviderRequest,
  type AIProviderResponse,
} from '../../../core/ai-provider';
import { OpenAIRequestMapper, OpenAIResponseMapper } from '../mapper';
import {
  OPENAI_PROVIDER_ID,
  type OpenAIClock,
  type OpenAIProviderConfiguration,
  type OpenAIProviderCredentials,
  type OpenAIResponsesClient,
} from '../types';
import { OpenAIConfigurationValidator } from '../validators';
import { OpenAIErrorMapper } from './openai-error.mapper';
import { OpenAISdkResponsesClient } from './openai-sdk-responses.client';

export class OpenAIProvider implements AIProvider {
  readonly descriptor: AIProviderDescriptor;
  private readonly requestMapper: OpenAIRequestMapper;
  private readonly responseMapper: OpenAIResponseMapper;
  private readonly errorMapper = new OpenAIErrorMapper();
  private readonly contract = new ProviderContractService();

  constructor(
    private readonly configuration: OpenAIProviderConfiguration,
    private readonly client: OpenAIResponsesClient,
    private readonly clock: OpenAIClock = systemClock,
  ) {
    const validator: OpenAIConfigurationValidator = new OpenAIConfigurationValidator();
    validator.validate(configuration);
    this.descriptor = createDescriptor(configuration);
    this.requestMapper = new OpenAIRequestMapper(this.descriptor, configuration);
    this.responseMapper = new OpenAIResponseMapper(clock);
  }

  async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (request.cancellation.cancelled) {
      throw new ProviderCancelledError(request.requestId, request.cancellation.reason);
    }
    const mappedRequest = this.requestMapper.map(request);
    const controller = new AbortController();
    let cancellationReason = request.cancellation.reason;
    const unsubscribe = request.cancellation.subscribe((reason) => {
      cancellationReason = reason;
      controller.abort();
    });
    const startedAt = this.clock();
    try {
      const raw = await this.client.create(mappedRequest, {
        timeoutMs: request.timeoutMs,
        signal: controller.signal,
      });
      const response = this.responseMapper.map(raw, request, mappedRequest, startedAt);
      this.contract.validateExchange(request, response);
      return response;
    } catch (error: unknown) {
      throw this.errorMapper.map(error, request.requestId, request.timeoutMs, cancellationReason);
    } finally {
      unsubscribe();
    }
  }
}

export function createOpenAIProvider(
  configuration: OpenAIProviderConfiguration,
  credentials: OpenAIProviderCredentials,
  clock?: OpenAIClock,
): OpenAIProvider {
  return new OpenAIProvider(
    configuration,
    new OpenAISdkResponsesClient(credentials, configuration),
    clock,
  );
}

function createDescriptor(configuration: OpenAIProviderConfiguration): AIProviderDescriptor {
  return {
    contractVersion: AI_PROVIDER_CONTRACT_VERSION,
    id: OPENAI_PROVIDER_ID,
    displayName: 'OpenAI Responses API',
    capabilities: {
      contextIngestion: true,
      structuredOutput: true,
      streaming: false,
      toolCalling: false,
      reasoning: false,
      fileSupport: false,
      imageSupport: false,
      maximumContextCharacters: configuration.maximumInputCharacters,
      structuredResponses: true,
    },
  };
}

function systemClock(): string {
  return new Date().toISOString();
}
