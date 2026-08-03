import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import type {
  OpenRouterChatClient,
  OpenRouterChatClientOptions,
  OpenRouterChatCompletionRequest,
  OpenRouterProviderConfiguration,
  OpenRouterProviderCredentials,
} from '../types';
import { OpenRouterConfigurationValidator, OpenRouterCredentialsValidator } from '../validators';

export interface OpenRouterSdkClientFactoryOptions {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout: number;
  readonly maxRetries: 0;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export interface OpenRouterSdkClient {
  readonly chat: {
    readonly completions: {
      create(
        request: ChatCompletionCreateParamsNonStreaming,
        options: { readonly timeout: number; readonly signal: AbortSignal; readonly maxRetries: 0 },
      ): Promise<unknown>;
    };
  };
}

export type OpenRouterSdkClientFactory = (
  options: OpenRouterSdkClientFactoryOptions,
) => OpenRouterSdkClient;

/** The only class in BuilderAI allowed to depend on the OpenAI SDK for OpenRouter transport. */
export class OpenRouterSdkChatClient implements OpenRouterChatClient {
  private readonly client: OpenRouterSdkClient;

  constructor(
    credentials: OpenRouterProviderCredentials,
    configuration: OpenRouterProviderConfiguration,
    clientFactory: OpenRouterSdkClientFactory = createSdkClient,
  ) {
    const configurationValidator: OpenRouterConfigurationValidator =
      new OpenRouterConfigurationValidator();
    configurationValidator.validate(configuration);
    const validator: OpenRouterCredentialsValidator = new OpenRouterCredentialsValidator();
    validator.validate(credentials);
    const defaultHeaders: Record<string, string> = {};
    if (credentials.httpReferer !== undefined) {
      defaultHeaders['HTTP-Referer'] = credentials.httpReferer;
    }
    if (credentials.appTitle !== undefined) {
      defaultHeaders['X-Title'] = credentials.appTitle;
    }
    this.client = clientFactory({
      apiKey: credentials.apiKey,
      baseURL: credentials.baseUrl,
      timeout: configuration.defaultTimeoutMs,
      maxRetries: 0,
      ...(Object.keys(defaultHeaders).length > 0 ? { defaultHeaders } : {}),
    });
  }

  async create(
    request: OpenRouterChatCompletionRequest,
    options: OpenRouterChatClientOptions,
  ): Promise<unknown> {
    const sdkRequest: ChatCompletionCreateParamsNonStreaming = {
      ...request,
      messages: [...request.messages],
    };
    return this.client.chat.completions.create(sdkRequest, {
      timeout: options.timeoutMs,
      signal: options.signal,
      maxRetries: 0,
    });
  }
}

function createSdkClient(options: OpenRouterSdkClientFactoryOptions): OpenRouterSdkClient {
  return new OpenAI(options);
}
