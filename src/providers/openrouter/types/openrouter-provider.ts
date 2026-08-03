import type { AIProviderResponse, ProviderJsonValue } from '../../../core/ai-provider';
import type { ExecutionResult } from '../../../core/execution-engine';

export const OPENROUTER_PROVIDER_ID = 'openrouter-chat' as const;

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1' as const;

export interface OpenRouterProviderConfiguration {
  readonly model: string;
  readonly defaultTimeoutMs: number;
  readonly maximumTimeoutMs: number;
  readonly maximumInputCharacters: number;
  readonly maximumOutputCharacters: number;
  readonly maximumOutputTokens: number;
}

export interface OpenRouterProviderCredentials {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly httpReferer?: string;
  readonly appTitle?: string;
}

export interface OpenRouterJsonSchema {
  readonly [key: string]: unknown;
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, OpenRouterJsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: OpenRouterJsonSchema;
  readonly additionalProperties?: boolean;
}

export interface OpenRouterChatMessage {
  readonly role: 'user';
  readonly content: string;
}

export interface OpenRouterChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly [OpenRouterChatMessage];
  readonly max_tokens: number;
  readonly response_format: {
    readonly type: 'json_schema';
    readonly json_schema: {
      readonly name: 'builderai_response';
      readonly description: string;
      readonly strict: false;
      readonly schema: OpenRouterJsonSchema;
    };
  };
}

export interface OpenRouterChatClientOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface OpenRouterChatClient {
  create(
    request: OpenRouterChatCompletionRequest,
    options: OpenRouterChatClientOptions,
  ): Promise<unknown>;
}

export interface OpenRouterRawResponseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface OpenRouterRawResponse {
  readonly id: string;
  readonly model: string;
  readonly finishReason: string;
  readonly content: string;
  readonly usage: OpenRouterRawResponseUsage;
}

export interface OpenRouterExecutionOutput {
  readonly providerResponse: AIProviderResponse;
  readonly executionResult: ExecutionResult;
  readonly structuredOutput: ProviderJsonValue;
}

export type OpenRouterClock = () => string;
