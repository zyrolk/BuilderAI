import {
  AI_PROVIDER_CONTRACT_VERSION,
  ProviderCancelledError,
  ProviderContractService,
  type AIProvider,
  type AIProviderDescriptor,
  type AIProviderRequest,
  type AIProviderResponse,
} from '../../../core/ai-provider';
import { OpenRouterRequestMapper, OpenRouterResponseMapper } from '../mapper';
import {
  OPENROUTER_PROVIDER_ID,
  type OpenRouterChatClient,
  type OpenRouterClock,
  type OpenRouterProviderConfiguration,
  type OpenRouterProviderCredentials,
} from '../types';
import { OpenRouterConfigurationValidator } from '../validators';
import { OpenRouterErrorMapper } from './openrouter-error.mapper';
import { OpenRouterSdkChatClient } from './openrouter-sdk-chat.client';

export class OpenRouterProvider implements AIProvider {
  readonly descriptor: AIProviderDescriptor;
  private readonly requestMapper: OpenRouterRequestMapper;
  private readonly responseMapper: OpenRouterResponseMapper;
  private readonly errorMapper = new OpenRouterErrorMapper();
  private readonly contract = new ProviderContractService();

  constructor(
    private readonly configuration: OpenRouterProviderConfiguration,
    private readonly client: OpenRouterChatClient,
    private readonly clock: OpenRouterClock = systemClock,
  ) {
    const validator: OpenRouterConfigurationValidator = new OpenRouterConfigurationValidator();
    validator.validate(configuration);
    this.descriptor = createDescriptor(configuration);
    this.requestMapper = new OpenRouterRequestMapper(this.descriptor, configuration);
    this.responseMapper = new OpenRouterResponseMapper(clock);
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

export function createOpenRouterProvider(
  configuration: OpenRouterProviderConfiguration,
  credentials: OpenRouterProviderCredentials,
  clock?: OpenRouterClock,
): OpenRouterProvider {
  return new OpenRouterProvider(
    configuration,
    new OpenRouterSdkChatClient(credentials, configuration),
    clock,
  );
}

function createDescriptor(configuration: OpenRouterProviderConfiguration): AIProviderDescriptor {
  return {
    contractVersion: AI_PROVIDER_CONTRACT_VERSION,
    id: OPENROUTER_PROVIDER_ID,
    displayName: 'OpenRouter Chat Completions',
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
