import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GoogleGenAIOptions,
} from '@google/genai';
import type {
  GeminiClient,
  GeminiClientOptions,
  GeminiGenerateContentRequest,
  GeminiProviderConfiguration,
  GeminiProviderCredentials,
} from '../types';
import { GeminiConfigurationValidator, GeminiCredentialsValidator } from '../validators';

export interface GeminiSdkClient {
  readonly models: {
    generateContent(request: GenerateContentParameters): Promise<unknown>;
  };
}

export type GeminiSdkClientFactory = (options: GoogleGenAIOptions) => GeminiSdkClient;

/** The only class in BuilderAI allowed to depend on the Gemini provider SDK. */
export class GeminiSdkClientAdapter implements GeminiClient {
  private readonly client: GeminiSdkClient;

  constructor(
    credentials: GeminiProviderCredentials,
    configuration: GeminiProviderConfiguration,
    clientFactory: GeminiSdkClientFactory = createSdkClient,
  ) {
    const configurationValidator: GeminiConfigurationValidator = new GeminiConfigurationValidator();
    configurationValidator.validate(configuration);
    const credentialsValidator: GeminiCredentialsValidator = new GeminiCredentialsValidator();
    credentialsValidator.validate(credentials);
    this.client = clientFactory({
      apiKey: credentials.apiKey,
      httpOptions: {
        timeout: configuration.defaultTimeoutMs,
        retryOptions: { attempts: 1 },
      },
    });
  }

  generateContent(
    request: GeminiGenerateContentRequest,
    options: GeminiClientOptions,
  ): Promise<unknown> {
    return this.client.models.generateContent({
      ...request,
      config: {
        ...request.config,
        abortSignal: options.signal,
        httpOptions: {
          timeout: options.timeoutMs,
          retryOptions: { attempts: 1 },
        },
      },
    });
  }
}

function createSdkClient(options: GoogleGenAIOptions): GeminiSdkClient {
  return new GoogleGenAI(options);
}
