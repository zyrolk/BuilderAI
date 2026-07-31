import type { AIProviderRequest } from '../../../core/ai-provider';
import { createRequest } from '../../../core/ai-provider/test/ai-provider.fixture';
import type {
  OpenAIClock,
  OpenAIProviderConfiguration,
  OpenAIResponseCreateRequest,
  OpenAIResponsesClient,
  OpenAIResponsesClientOptions,
} from '../types';

export function createOpenAIConfiguration(
  overrides: Partial<OpenAIProviderConfiguration> = {},
): OpenAIProviderConfiguration {
  return {
    model: 'test-model',
    defaultTimeoutMs: 1_000,
    maximumTimeoutMs: 30_000,
    maximumInputCharacters: 1_000_000,
    maximumOutputCharacters: 20_000,
    maximumOutputTokens: 2_000,
    ...overrides,
  };
}

export async function createOpenAIRequest(
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

export function completedRawResponse(outputText = validOutputText()): Record<string, unknown> {
  return {
    id: 'resp-test-one',
    model: 'test-model',
    status: 'completed',
    output_text: outputText,
    error: null,
    usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
  };
}

export function validOutputText(): string {
  return JSON.stringify({ summary: 'Completed.', artifacts: [], diagnostics: [] });
}

export class FakeOpenAIResponsesClient implements OpenAIResponsesClient {
  readonly calls: Array<{
    readonly request: OpenAIResponseCreateRequest;
    readonly options: OpenAIResponsesClientOptions;
  }> = [];

  constructor(
    private readonly result: unknown = completedRawResponse(),
    private readonly failure?: unknown,
  ) {}

  async create(
    request: OpenAIResponseCreateRequest,
    options: OpenAIResponsesClientOptions,
  ): Promise<unknown> {
    this.calls.push({ request, options });
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }
}

export function sequenceClock(values: readonly string[]): OpenAIClock {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error('Fixture clock exhausted.');
    return value;
  };
}
