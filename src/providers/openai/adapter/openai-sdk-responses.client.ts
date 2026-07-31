import OpenAI from 'openai';
import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import type {
  OpenAIProviderConfiguration,
  OpenAIProviderCredentials,
  OpenAIResponseCreateRequest,
  OpenAIResponsesClient,
  OpenAIResponsesClientOptions,
} from '../types';
import { OpenAIConfigurationValidator, OpenAICredentialsValidator } from '../validators';

export interface OpenAISdkClientFactoryOptions {
  readonly apiKey: string;
  readonly timeout: number;
  readonly maxRetries: 0;
}

export interface OpenAISdkClient {
  readonly responses: {
    create(
      request: ResponseCreateParamsNonStreaming,
      options: { readonly timeout: number; readonly signal: AbortSignal; readonly maxRetries: 0 },
    ): Promise<unknown>;
  };
}

export type OpenAISdkClientFactory = (options: OpenAISdkClientFactoryOptions) => OpenAISdkClient;

/** The only class in BuilderAI allowed to depend on the provider SDK. */
export class OpenAISdkResponsesClient implements OpenAIResponsesClient {
  private readonly client: OpenAISdkClient;

  constructor(
    credentials: OpenAIProviderCredentials,
    configuration: OpenAIProviderConfiguration,
    clientFactory: OpenAISdkClientFactory = createSdkClient,
  ) {
    const configurationValidator: OpenAIConfigurationValidator = new OpenAIConfigurationValidator();
    configurationValidator.validate(configuration);
    const validator: OpenAICredentialsValidator = new OpenAICredentialsValidator();
    validator.validate(credentials);
    this.client = clientFactory({
      apiKey: credentials.apiKey,
      timeout: configuration.defaultTimeoutMs,
      maxRetries: 0,
    });
  }

  async create(
    request: OpenAIResponseCreateRequest,
    options: OpenAIResponsesClientOptions,
  ): Promise<unknown> {
    const sdkRequest: ResponseCreateParamsNonStreaming = request;
    return this.client.responses.create(sdkRequest, {
      timeout: options.timeoutMs,
      signal: options.signal,
      maxRetries: 0,
    });
  }
}

function createSdkClient(options: OpenAISdkClientFactoryOptions): OpenAISdkClient {
  return new OpenAI(options);
}
