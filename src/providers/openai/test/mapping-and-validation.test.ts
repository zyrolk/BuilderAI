import {
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderUnavailableError,
  UnsupportedCapabilityError,
} from '../../../core/ai-provider';
import type { PromptOutputContractSection } from '../../../core/prompt-orchestrator';
import { OpenAIProvider } from '../adapter';
import { OpenAIRequestMapper, OpenAIResponseMapper } from '../mapper';
import { OpenAIRawResponseValidator, OpenAIStructuredOutputValidator } from '../validators';
import {
  completedRawResponse,
  createOpenAIConfiguration,
  createOpenAIRequest,
  FakeOpenAIResponsesClient,
  sequenceClock,
} from './openai-provider.fixture';

describe('OpenAI request mapping', () => {
  it('maps the Prompt Package deterministically without mutating it', async () => {
    const configuration = createOpenAIConfiguration();
    const provider = new OpenAIProvider(configuration, new FakeOpenAIResponsesClient());
    const mapper = new OpenAIRequestMapper(provider.descriptor, configuration);
    const request = await createOpenAIRequest();
    const before = structuredClone(request.prompt);
    const mapped = mapper.map(request);

    expect(request.prompt).toEqual(before);
    expect(JSON.parse(mapped.input)).toEqual(request.prompt);
    expect(mapped).toMatchObject({
      model: 'test-model',
      stream: false,
      background: false,
      store: false,
      truncation: 'disabled',
      parallel_tool_calls: false,
      max_output_tokens: 2_000,
    });
    expect(mapped).not.toHaveProperty('tools');
    expect(mapped).not.toHaveProperty('previous_response_id');
    expect(mapped.text.format).toMatchObject({ type: 'json_schema', strict: false });
    expect(mapped.text.format.schema.required).toEqual(['summary', 'artifacts', 'diagnostics']);
  });

  it('rejects unsupported execution modes and provider limits', async () => {
    const configuration = createOpenAIConfiguration();
    const provider = new OpenAIProvider(configuration, new FakeOpenAIResponsesClient());
    const mapper = new OpenAIRequestMapper(provider.descriptor, configuration);
    await expect(async () =>
      mapper.map(await createOpenAIRequest({ executionMode: 'STREAMING' })),
    ).rejects.toThrow(UnsupportedCapabilityError);
    const oversized = await createOpenAIRequest({
      constraints: {
        maximumOutputCharacters: 20_001,
        requiredArtifactKinds: ['STRUCTURED_DATA'],
        requiredCapabilities: [],
        requireStructuredResponse: true,
      },
    });
    expect(() => mapper.map(oversized)).toThrow(ProviderContractViolationError);
    const smallInputConfiguration = createOpenAIConfiguration({ maximumInputCharacters: 1 });
    const smallInputProvider = new OpenAIProvider(
      smallInputConfiguration,
      new FakeOpenAIResponsesClient(),
    );
    const validRequest = await createOpenAIRequest();
    expect(() =>
      new OpenAIRequestMapper(smallInputProvider.descriptor, smallInputConfiguration).map(
        validRequest,
      ),
    ).toThrow(ProviderContractViolationError);
  });
});

describe('OpenAI response validation and mapping', () => {
  const rawValidator = new OpenAIRawResponseValidator();

  it('validates and normalizes every consumed response field', () => {
    expect(rawValidator.parse(completedRawResponse())).toEqual({
      id: 'resp-test-one',
      model: 'test-model',
      status: 'completed',
      outputText: '{"summary":"Completed.","artifacts":[],"diagnostics":[]}',
      error: null,
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    });
  });

  it.each([
    {},
    { id: 'x', model: 'm', status: 'unknown', output_text: '', error: null, usage: null },
    { id: 'x', model: 'm', status: 'completed', output_text: '', error: null, usage: null },
    {
      id: 'x',
      model: 'm',
      status: 'completed',
      output_text: '',
      error: null,
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 3 },
    },
    { id: 'x', model: 'm', status: 'failed', output_text: '', error: null, usage: null },
  ])('rejects malformed raw responses %#', (raw) => {
    expect(() => rawValidator.parse(raw)).toThrow(ProviderContractViolationError);
  });

  it('enforces the Prompt Package output contract and JSON-only values', async () => {
    const request = await createOpenAIRequest();
    const section = request.prompt.sections.find(
      (candidate): candidate is PromptOutputContractSection => candidate.kind === 'OUTPUT_CONTRACT',
    );
    expect(section).toBeDefined();
    if (section === undefined) return;
    const validator: OpenAIStructuredOutputValidator = new OpenAIStructuredOutputValidator();
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
    const configuration = createOpenAIConfiguration();
    const request = await createOpenAIRequest();
    const provider = new OpenAIProvider(configuration, new FakeOpenAIResponsesClient());
    const providerRequest = new OpenAIRequestMapper(provider.descriptor, configuration).map(
      request,
    );
    const response = new OpenAIResponseMapper(sequenceClock(['2026-07-30T16:00:01.000Z'])).map(
      completedRawResponse(),
      request,
      providerRequest,
      '2026-07-30T16:00:00.000Z',
    );
    expect(response.status).toBe('COMPLETED');
    expect(response.artifacts.map(({ kind }) => kind)).toEqual(['TEXT', 'STRUCTURED_DATA']);
    expect(response.metadata).toMatchObject({ 'total-tokens': 125, 'openai-model': 'test-model' });
    expect(response.statistics.durationMs).toBe(1_000);
  });

  it('rejects invalid JSON, invalid output contracts, nonterminal responses, and provider failures', async () => {
    const configuration = createOpenAIConfiguration();
    const request = await createOpenAIRequest();
    const provider = new OpenAIProvider(configuration, new FakeOpenAIResponsesClient());
    const mapped = new OpenAIRequestMapper(provider.descriptor, configuration).map(request);
    const createMapper = () =>
      new OpenAIResponseMapper(sequenceClock(['2026-07-30T16:00:01.000Z']));
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
    const pending = { ...completedRawResponse(), status: 'in_progress', usage: null };
    expect(() => createMapper().map(pending, request, mapped, '2026-07-30T16:00:00.000Z')).toThrow(
      ProviderContractViolationError,
    );
    const failed = {
      ...completedRawResponse(),
      status: 'failed',
      error: { code: 'server_error', message: 'down' },
      usage: null,
    };
    expect(() => createMapper().map(failed, request, mapped, '2026-07-30T16:00:00.000Z')).toThrow(
      ProviderUnavailableError,
    );
    const rejected = {
      ...failed,
      error: { code: 'invalid_request', message: 'invalid' },
    };
    expect(() => createMapper().map(rejected, request, mapped, '2026-07-30T16:00:00.000Z')).toThrow(
      ProviderContractViolationError,
    );
    const cancelled = {
      ...failed,
      status: 'cancelled',
      error: { code: 'cancelled', message: 'provider detail' },
    };
    expect(() =>
      createMapper().map(cancelled, request, mapped, '2026-07-30T16:00:00.000Z'),
    ).toThrow(ProviderCancelledError);
  });
});
