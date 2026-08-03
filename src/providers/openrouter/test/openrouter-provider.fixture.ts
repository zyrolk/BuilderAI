import type { AIProviderRequest } from '../../../core/ai-provider';
import { createRequest } from '../../../core/ai-provider/test/ai-provider.fixture';
import type {
  OpenRouterChatClient,
  OpenRouterChatClientOptions,
  OpenRouterChatCompletionRequest,
  OpenRouterClock,
  OpenRouterProviderConfiguration,
  OpenRouterProviderCredentials,
} from '../types';
import { OPENROUTER_DEFAULT_BASE_URL } from '../types';

export function createOpenRouterConfiguration(
  overrides: Partial<OpenRouterProviderConfiguration> = {},
): OpenRouterProviderConfiguration {
  return {
    model: 'test/openrouter-model',
    defaultTimeoutMs: 1_000,
    maximumTimeoutMs: 30_000,
    maximumInputCharacters: 1_000_000,
    maximumOutputCharacters: 20_000,
    maximumOutputTokens: 2_000,
    ...overrides,
  };
}

export function createOpenRouterCredentials(
  overrides: Partial<OpenRouterProviderCredentials> = {},
): OpenRouterProviderCredentials {
  return {
    apiKey: 'openrouter-test-secret',
    baseUrl: OPENROUTER_DEFAULT_BASE_URL,
    ...overrides,
  };
}

export async function createOpenRouterRequest(
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

export function completedRawResponse(content = validOutputText()): Record<string, unknown> {
  return {
    id: 'chatcmpl-test-one',
    model: 'test/openrouter-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
  };
}

export function validOutputText(): string {
  return JSON.stringify({ summary: 'Completed.', artifacts: [], diagnostics: [] });
}

export class FakeOpenRouterChatClient implements OpenRouterChatClient {
  readonly calls: Array<{
    readonly request: OpenRouterChatCompletionRequest;
    readonly options: OpenRouterChatClientOptions;
  }> = [];

  constructor(
    private readonly result: unknown = completedRawResponse(),
    private readonly failure?: unknown,
  ) {}

  async create(
    request: OpenRouterChatCompletionRequest,
    options: OpenRouterChatClientOptions,
  ): Promise<unknown> {
    this.calls.push({ request, options });
    if (this.failure !== undefined) throw this.failure;
    return this.result;
  }
}

export function sequenceClock(values: readonly string[]): OpenRouterClock {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) throw new Error('Fixture clock exhausted.');
    return value;
  };
}
