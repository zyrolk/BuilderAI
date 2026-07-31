import type { AIProviderResponse, ProviderJsonValue } from '../../../core/ai-provider';
import type { ExecutionResult } from '../../../core/execution-engine';

export const OPENAI_PROVIDER_ID = 'openai-responses' as const;

export interface OpenAIProviderConfiguration {
  readonly model: string;
  readonly defaultTimeoutMs: number;
  readonly maximumTimeoutMs: number;
  readonly maximumInputCharacters: number;
  readonly maximumOutputCharacters: number;
  readonly maximumOutputTokens: number;
}

export interface OpenAIProviderCredentials {
  readonly apiKey: string;
}

export interface OpenAIJsonSchema {
  readonly [key: string]: unknown;
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, OpenAIJsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: OpenAIJsonSchema;
  readonly additionalProperties?: boolean;
}

export interface OpenAIResponseCreateRequest {
  readonly model: string;
  readonly input: string;
  readonly stream: false;
  readonly background: false;
  readonly store: false;
  readonly truncation: 'disabled';
  readonly parallel_tool_calls: false;
  readonly max_output_tokens: number;
  readonly text: {
    readonly format: {
      readonly type: 'json_schema';
      readonly name: 'builderai_response';
      readonly description: string;
      readonly strict: false;
      readonly schema: OpenAIJsonSchema;
    };
  };
}

export interface OpenAIResponsesClientOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface OpenAIResponsesClient {
  create(
    request: OpenAIResponseCreateRequest,
    options: OpenAIResponsesClientOptions,
  ): Promise<unknown>;
}

export interface OpenAIRawResponseError {
  readonly code: string;
  readonly message: string;
}

export interface OpenAIRawResponseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface OpenAIRawResponse {
  readonly id: string;
  readonly model: string;
  readonly status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
  readonly outputText: string;
  readonly error: OpenAIRawResponseError | null;
  readonly usage: OpenAIRawResponseUsage | null;
}

export interface OpenAIExecutionOutput {
  readonly providerResponse: AIProviderResponse;
  readonly executionResult: ExecutionResult;
  readonly structuredOutput: ProviderJsonValue;
}

export type OpenAIClock = () => string;
