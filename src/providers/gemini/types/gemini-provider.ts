import type { AIProviderResponse, ProviderJsonValue } from '../../../core/ai-provider';
import type { ExecutionResult } from '../../../core/execution-engine';

export const GEMINI_PROVIDER_ID = 'google-gemini' as const;

export interface GeminiProviderConfiguration {
  readonly model: string;
  readonly defaultTimeoutMs: number;
  readonly maximumTimeoutMs: number;
  readonly maximumInputCharacters: number;
  readonly maximumOutputCharacters: number;
  readonly maximumOutputTokens: number;
}

export interface GeminiProviderCredentials {
  readonly apiKey: string;
}

export interface GeminiJsonSchema {
  readonly [key: string]: unknown;
  readonly type?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, GeminiJsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: GeminiJsonSchema;
  readonly enum?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface GeminiGenerateContentRequest {
  readonly model: string;
  readonly contents: string;
  readonly config: {
    readonly candidateCount: 1;
    readonly maxOutputTokens: number;
    readonly responseMimeType: 'application/json';
    readonly responseJsonSchema: GeminiJsonSchema;
    readonly temperature: 0;
  };
}

export interface GeminiClientOptions {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface GeminiClient {
  generateContent(
    request: GeminiGenerateContentRequest,
    options: GeminiClientOptions,
  ): Promise<unknown>;
}

export interface GeminiRawResponseUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface GeminiRawResponse {
  readonly responseId?: string;
  readonly modelVersion?: string;
  readonly text: string;
  readonly finishReason: string;
  readonly usage: GeminiRawResponseUsage;
}

export interface GeminiExecutionOutput {
  readonly providerResponse: AIProviderResponse;
  readonly executionResult: ExecutionResult;
  readonly structuredOutput: ProviderJsonValue;
}

export type GeminiClock = () => string;
