import {
  ProviderContractViolationError,
  ProviderOutputTruncatedError,
  UnsupportedCapabilityError,
} from '../../../core/ai-provider';
import type { PromptOutputContractSection } from '../../../core/prompt-orchestrator';
import { OpenRouterProvider } from '../adapter';
import { OpenRouterRequestMapper, OpenRouterResponseMapper } from '../mapper';
import { OpenRouterRawResponseValidator, OpenRouterStructuredOutputValidator } from '../validators';
import {
  completedRawResponse,
  createOpenRouterConfiguration,
  createOpenRouterRequest,
  FakeOpenRouterChatClient,
  sequenceClock,
} from './openrouter-provider.fixture';

describe('OpenRouter request mapping', () => {
  it('maps the Prompt Package deterministically without mutating it', async () => {
    const configuration = createOpenRouterConfiguration();
    const provider = new OpenRouterProvider(configuration, new FakeOpenRouterChatClient());
    const mapper = new OpenRouterRequestMapper(provider.descriptor, configuration);
    const request = await createOpenRouterRequest();
    const before = structuredClone(request.prompt);
    const mapped = mapper.map(request);

    expect(request.prompt).toEqual(before);
    expect(JSON.parse(mapped.messages[0].content)).toEqual(request.prompt);
    expect(mapped).toMatchObject({
      model: 'test/openrouter-model',
      max_tokens: 2_000,
    });
    expect(mapped.response_format).toMatchObject({ type: 'json_schema' });
    expect(mapped.response_format.json_schema.strict).toBe(false);
    expect(mapped.response_format.json_schema.schema.required).toEqual([
      'summary',
      'artifacts',
      'diagnostics',
    ]);
  });

  it('rejects unsupported execution modes and provider limits', async () => {
    const configuration = createOpenRouterConfiguration();
    const provider = new OpenRouterProvider(configuration, new FakeOpenRouterChatClient());
    const mapper = new OpenRouterRequestMapper(provider.descriptor, configuration);
    await expect(async () =>
      mapper.map(await createOpenRouterRequest({ executionMode: 'STREAMING' })),
    ).rejects.toThrow(UnsupportedCapabilityError);
    const oversized = await createOpenRouterRequest({
      constraints: {
        maximumOutputCharacters: 20_001,
        requiredArtifactKinds: ['STRUCTURED_DATA'],
        requiredCapabilities: [],
        requireStructuredResponse: true,
      },
    });
    expect(() => mapper.map(oversized)).toThrow(ProviderContractViolationError);
    const smallInputConfiguration = createOpenRouterConfiguration({ maximumInputCharacters: 1 });
    const smallInputProvider = new OpenRouterProvider(
      smallInputConfiguration,
      new FakeOpenRouterChatClient(),
    );
    const validRequest = await createOpenRouterRequest();
    expect(() =>
      new OpenRouterRequestMapper(smallInputProvider.descriptor, smallInputConfiguration).map(
        validRequest,
      ),
    ).toThrow(ProviderContractViolationError);
  });
});

describe('OpenRouter response validation and mapping', () => {
  const rawValidator = new OpenRouterRawResponseValidator();

  it('validates and normalizes every consumed response field', () => {
    expect(rawValidator.parse(completedRawResponse())).toEqual({
      id: 'chatcmpl-test-one',
      model: 'test/openrouter-model',
      finishReason: 'stop',
      content: '{"summary":"Completed.","artifacts":[],"diagnostics":[]}',
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    });
  });

  it.each([
    {},
    {
      id: 'x',
      model: 'm',
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 },
    },
    {
      id: 'x',
      model: 'm',
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 },
    },
    {
      id: 'x',
      model: 'm',
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, output_tokens: 1, total_tokens: 3 },
    },
  ])('rejects malformed raw responses %#', (raw) => {
    expect(() => rawValidator.parse(raw)).toThrow(ProviderContractViolationError);
  });

  it('enforces the Prompt Package output contract and JSON-only values', async () => {
    const request = await createOpenRouterRequest();
    const section = request.prompt.sections.find(
      (candidate): candidate is PromptOutputContractSection => candidate.kind === 'OUTPUT_CONTRACT',
    );
    expect(section).toBeDefined();
    if (section === undefined) return;
    const validator: OpenRouterStructuredOutputValidator =
      new OpenRouterStructuredOutputValidator();
    expect(() =>
      validator.validate({ summary: 'ok', artifacts: [], diagnostics: [] }, section.expectedOutput),
    ).not.toThrow();
    expect(() =>
      validator.validate({ summary: 1, artifacts: [], diagnostics: [] }, section.expectedOutput),
    ).toThrow(ProviderContractViolationError);
    expect(() =>
      validator.validate({ summary: 'ok', artifacts: [] }, section.expectedOutput),
    ).toThrow(ProviderContractViolationError);
    expect(() =>
      validator.validate(
        { summary: 'ok', artifacts: [], diagnostics: [], extra: true },
        section.expectedOutput,
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('maps completed output and token usage to the BuilderAI response', async () => {
    const configuration = createOpenRouterConfiguration();
    const request = await createOpenRouterRequest();
    const provider = new OpenRouterProvider(configuration, new FakeOpenRouterChatClient());
    const providerRequest = new OpenRouterRequestMapper(provider.descriptor, configuration).map(
      request,
    );
    const response = new OpenRouterResponseMapper(sequenceClock(['2026-07-30T16:00:01.000Z'])).map(
      completedRawResponse(),
      request,
      providerRequest,
      '2026-07-30T16:00:00.000Z',
    );
    expect(response.status).toBe('COMPLETED');
    expect(response.artifacts.map(({ kind }) => kind)).toEqual(['TEXT', 'STRUCTURED_DATA']);
    expect(response.metadata).toMatchObject({
      'total-tokens': 125,
      'openrouter-model': 'test/openrouter-model',
      'finish-reason': 'stop',
    });
    expect(response.statistics.durationMs).toBe(1_000);
  });

  it('rejects invalid JSON and invalid output contracts', async () => {
    const configuration = createOpenRouterConfiguration();
    const request = await createOpenRouterRequest();
    const provider = new OpenRouterProvider(configuration, new FakeOpenRouterChatClient());
    const mapped = new OpenRouterRequestMapper(provider.descriptor, configuration).map(request);
    const createMapper = () =>
      new OpenRouterResponseMapper(sequenceClock(['2026-07-30T16:00:01.000Z']));
    expect(() =>
      createMapper().map(completedRawResponse('{'), request, mapped, '2026-07-30T16:00:00.000Z'),
    ).toThrow(ProviderContractViolationError);
    expect(() =>
      createMapper().map(
        completedRawResponse('{"summary":1,"artifacts":[],"diagnostics":[]}'),
        request,
        mapped,
        '2026-07-30T16:00:00.000Z',
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('treats finish_reason=length as OUTPUT_TRUNCATED at the raw validator', () => {
    expect(() =>
      rawValidator.parse({
        ...completedRawResponse(),
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: validOutputText() },
            finish_reason: 'length',
          },
        ],
      }),
    ).toThrow(ProviderOutputTruncatedError);
  });

  it('treats content_filter finish reason as terminal CONTRACT_VIOLATION', () => {
    expect(() =>
      rawValidator.parse({
        ...completedRawResponse(),
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: validOutputText() },
            finish_reason: 'content_filter',
          },
        ],
      }),
    ).toThrow(ProviderContractViolationError);
  });

  it('treats unsupported finish reasons as terminal CONTRACT_VIOLATION', () => {
    expect(() =>
      rawValidator.parse({
        ...completedRawResponse(),
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: validOutputText() },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    ).toThrow(ProviderContractViolationError);
  });
});

function validOutputText(): string {
  return JSON.stringify({ summary: 'Completed.', artifacts: [], diagnostics: [] });
}
