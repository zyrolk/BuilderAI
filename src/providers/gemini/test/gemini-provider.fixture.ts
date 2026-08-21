import type { AIProviderRequest } from '../../../core/ai-provider';
import { createRequest } from '../../../core/ai-provider/test/ai-provider.fixture';
import type {
  GeminiClient,
  GeminiClientOptions,
  GeminiClock,
  GeminiGenerateContentRequest,
  GeminiProviderConfiguration,
} from '../types';

export function createGeminiConfiguration(
  overrides: Partial<GeminiProviderConfiguration> = {},
): GeminiProviderConfiguration {
  return {
    model: 'gemini-test-model',
    defaultTimeoutMs: 1_000,
    maximumTimeoutMs: 30_000,
    maximumInputCharacters: 1_000_000,
    maximumOutputCharacters: 20_000,
    maximumOutputTokens: 2_000,
    ...overrides,
  };
}

export async function createGeminiRequest(
  overrides: Partial<AIProviderRequest> = {},
): Promise<AIProviderRequest> {
  return createRequest({
    constraints: {
      maximumOutputCharacters: 20_000,
      requiredArtifactKinds: ['TEXT', 'STRUCTURED_DATA'],
      requiredCapabilities: ['CONTEXT_INGESTION', 'STRUCTURED_RESPONSES'],
      requireStructuredResponse: true,
    },
    ...overrides,
  });
}

export function completedRawResponse(text = validOutputText()): Record<string, unknown> {
  return {
    responseId: 'gemini-response-one',
    modelVersion: 'gemini-test-model-001',
    text,
    candidates: [{ finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 25, totalTokenCount: 125 },
  };
}

export function validOutputText(): string {
  return JSON.stringify({ summary: 'Completed.', artifacts: [], diagnostics: [] });
}

export class FakeGeminiClient implements GeminiClient {
  readonly calls: Array<{
    readonly request: GeminiGenerateContentRequest;
    readonly options: GeminiClientOptions;
  }> = [];

  constructor(
    private readonly result: unknown = completedRawResponse(),
    private readonly failure?: unknown,
  ) {}

  async generateContent(
    request: GeminiGenerateContentRequest,
    options: GeminiClientOptions,
  ): Promise<unknown> {
    this.calls.push({ request, options });
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }
}

export function sequenceClock(values: readonly string[]): GeminiClock {
  let index = 0;
  let last = values[0];
  return () => {
    const value = values[index];
    index += 1;
    if (value !== undefined) {
      last = value;
      return value;
    }
    if (last === undefined) throw new Error('Fixture clock exhausted.');
    last = new Date(Date.parse(last) + 1).toISOString();
    return last;
  };
}
