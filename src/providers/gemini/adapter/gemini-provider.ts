import {
  AI_PROVIDER_CONTRACT_VERSION,
  ProviderCancelledError,
  ProviderContractService,
  type AIProvider,
  type AIProviderDescriptor,
  type AIProviderRequest,
  type AIProviderResponse,
} from '../../../core/ai-provider';
import { GeminiRequestMapper, GeminiResponseMapper } from '../mapper';
import {
  GEMINI_PROVIDER_ID,
  type GeminiClient,
  type GeminiClock,
  type GeminiProviderConfiguration,
  type GeminiProviderCredentials,
} from '../types';
import { GeminiConfigurationValidator } from '../validators';
import { GeminiErrorMapper } from './gemini-error.mapper';
import { GeminiSdkClientAdapter } from './gemini-sdk.client';

export class GeminiProvider implements AIProvider {
  readonly descriptor: AIProviderDescriptor;
  private readonly requestMapper: GeminiRequestMapper;
  private readonly responseMapper: GeminiResponseMapper;
  private readonly errorMapper = new GeminiErrorMapper();
  private readonly contract = new ProviderContractService();

  constructor(
    private readonly configuration: GeminiProviderConfiguration,
    private readonly client: GeminiClient,
    private readonly clock: GeminiClock = systemClock,
  ) {
    const validator: GeminiConfigurationValidator = new GeminiConfigurationValidator();
    validator.validate(configuration);
    this.descriptor = createDescriptor(configuration);
    this.requestMapper = new GeminiRequestMapper(this.descriptor, configuration);
    this.responseMapper = new GeminiResponseMapper(clock);
  }

  async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
    if (request.cancellation.cancelled) {
      throw new ProviderCancelledError(request.requestId, request.cancellation.reason);
    }
    const mappedRequest = this.requestMapper.map(request);
    const controller = new AbortController();
    let cancellationReason = request.cancellation.reason;
    let callerInitiatedAbort = false;
    const unsubscribe = request.cancellation.subscribe((reason) => {
      cancellationReason = reason;
      callerInitiatedAbort = true;
      controller.abort();
    });
    const startedAt = this.clock();
    try {
      const raw = await this.client.generateContent(mappedRequest, {
        timeoutMs: request.timeoutMs,
        signal: controller.signal,
      });
      const response = this.responseMapper.map(raw, request, mappedRequest, startedAt);
      this.contract.validateExchange(request, response);
      return response;
    } catch (error: unknown) {
      throw this.errorMapper.map(error, request.requestId, request.timeoutMs, {
        cancellationReason,
        callerInitiatedAbort,
      });
    } finally {
      unsubscribe();
    }
  }
}

export function createGeminiProvider(
  configuration: GeminiProviderConfiguration,
  credentials: GeminiProviderCredentials,
  clock?: GeminiClock,
): GeminiProvider {
  return new GeminiProvider(
    configuration,
    new GeminiSdkClientAdapter(credentials, configuration),
    clock,
  );
}

function createDescriptor(configuration: GeminiProviderConfiguration): AIProviderDescriptor {
  return {
    contractVersion: AI_PROVIDER_CONTRACT_VERSION,
    id: GEMINI_PROVIDER_ID,
    displayName: 'Google Gemini API',
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
