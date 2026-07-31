import {
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderUnavailableError,
  UnsupportedCapabilityError,
} from '../../../core/ai-provider';
import { createExecutionRequest } from '../../../core/execution-engine/test/execution-engine.fixture';
import { GeminiProvider } from '../adapter';
import { GeminiExecutionRequestMapper, GeminiRequestMapper, GeminiResponseMapper } from '../mapper';
import { GeminiExecutionService } from '../services';
import { GeminiRawResponseValidator } from '../validators';
import {
  completedRawResponse,
  createGeminiConfiguration,
  createGeminiRequest,
  FakeGeminiClient,
  sequenceClock,
} from './gemini-provider.fixture';

describe('Gemini request and response mapping', () => {
  it('maps the Prompt Package deterministically without mutating it', async () => {
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(configuration, new FakeGeminiClient());
    const mapper = new GeminiRequestMapper(provider.descriptor, configuration);
    const request = await createGeminiRequest();
    const before = structuredClone(request.prompt);
    const mapped = mapper.map(request);
    expect(request.prompt).toEqual(before);
    expect(JSON.parse(mapped.contents)).toEqual(request.prompt);
    expect(mapped.config).toMatchObject({
      candidateCount: 1,
      maxOutputTokens: 2_000,
      responseMimeType: 'application/json',
      temperature: 0,
    });
    expect(mapped.config.responseJsonSchema.required).toEqual([
      'summary',
      'artifacts',
      'diagnostics',
    ]);
    expect(mapped.config.responseJsonSchema.properties?.artifacts).toMatchObject({
      type: 'array',
      items: {
        type: 'object',
        required: ['logicalPath', 'type', 'content', 'metadata'],
        additionalProperties: false,
        properties: {
          type: {
            enum: ['SOURCE_FILE', 'DOCUMENTATION', 'CONFIGURATION', 'TEST', 'PATCH'],
          },
          metadata: {
            required: ['description', 'change-operation'],
            additionalProperties: false,
            properties: {
              'change-operation': {
                enum: ['CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE'],
              },
            },
          },
        },
      },
    });
    expect(mapped).not.toHaveProperty('tools');
  });

  it('rejects unsupported modes and configured limits', async () => {
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(configuration, new FakeGeminiClient());
    const mapper = new GeminiRequestMapper(provider.descriptor, configuration);
    await expect(async () =>
      mapper.map(await createGeminiRequest({ executionMode: 'STREAMING' })),
    ).rejects.toThrow(UnsupportedCapabilityError);
    const oversized = await createGeminiRequest({
      constraints: {
        maximumOutputCharacters: 20_001,
        requiredArtifactKinds: ['STRUCTURED_DATA'],
        requiredCapabilities: [],
        requireStructuredResponse: true,
      },
    });
    expect(() => mapper.map(oversized)).toThrow(ProviderContractViolationError);
  });

  it('validates every consumed raw response field and structured output', async () => {
    expect(new GeminiRawResponseValidator().parse(completedRawResponse())).toEqual({
      responseId: 'gemini-response-one',
      modelVersion: 'gemini-test-model-001',
      text: '{"summary":"Completed.","artifacts":[],"diagnostics":[]}',
      finishReason: 'STOP',
      usage: { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
    });
    expect(() =>
      new GeminiRawResponseValidator().parse({ ...completedRawResponse(), candidates: [] }),
    ).toThrow(ProviderContractViolationError);
    expect(() =>
      new GeminiRawResponseValidator().parse({
        ...completedRawResponse(),
        promptFeedback: { blockReason: 'SAFETY' },
      }),
    ).toThrow(ProviderContractViolationError);

    const configuration = createGeminiConfiguration();
    const request = await createGeminiRequest();
    const provider = new GeminiProvider(configuration, new FakeGeminiClient());
    const providerRequest = new GeminiRequestMapper(provider.descriptor, configuration).map(
      request,
    );
    expect(() =>
      new GeminiResponseMapper(sequenceClock(['2026-07-30T16:00:01.000Z'])).map(
        completedRawResponse('{'),
        request,
        providerRequest,
        '2026-07-30T16:00:00.000Z',
      ),
    ).toThrow(ProviderContractViolationError);
    const response = new GeminiResponseMapper(sequenceClock(['2026-07-30T16:00:01.000Z'])).map(
      completedRawResponse(),
      request,
      providerRequest,
      '2026-07-30T16:00:00.000Z',
    );
    expect(response.metadata).toMatchObject({
      'gemini-response-id': 'gemini-response-one',
      'total-tokens': 125,
    });
  });
});

describe('Gemini provider and Execution Engine integration', () => {
  it('declares only implemented capabilities and executes exactly once', async () => {
    const client = new FakeGeminiClient();
    const provider = new GeminiProvider(
      createGeminiConfiguration(),
      client,
      sequenceClock(['2026-07-30T16:00:00.000Z', '2026-07-30T16:00:01.000Z']),
    );
    expect((await provider.execute(await createGeminiRequest())).status).toBe('COMPLETED');
    expect(client.calls).toHaveLength(1);
    expect(provider.descriptor.capabilities).toMatchObject({
      streaming: false,
      toolCalling: false,
      fileSupport: false,
      imageSupport: false,
      structuredResponses: true,
    });
  });

  it('honors cancellation and does not retry failures', async () => {
    const cancelledClient = new FakeGeminiClient();
    const cancelledProvider = new GeminiProvider(createGeminiConfiguration(), cancelledClient);
    await expect(
      cancelledProvider.execute(
        await createGeminiRequest({
          cancellation: { cancelled: true, reason: 'stop', subscribe: () => () => undefined },
        }),
      ),
    ).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(cancelledClient.calls).toHaveLength(0);

    const failedClient = new FakeGeminiClient(undefined, new Error('offline'));
    const failedProvider = new GeminiProvider(createGeminiConfiguration(), failedClient);
    await expect(failedProvider.execute(await createGeminiRequest())).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(failedClient.calls).toHaveLength(1);
  });

  it('coordinates the existing state machine and returns validated structured output', async () => {
    const configuration = createGeminiConfiguration();
    const execution = await createExecutionRequest();
    const mapped = new GeminiExecutionRequestMapper().map(execution, configuration, 2);
    expect(mapped.prompt).toBe(execution.prompt);
    expect(mapped.metadata).toMatchObject({ attempt: 2, 'correlation-id': 'sprint-six' });
    const provider = new GeminiProvider(
      configuration,
      new FakeGeminiClient(),
      sequenceClock(['2026-07-30T18:00:06.000Z', '2026-07-30T18:00:07.000Z']),
    );
    const service = new GeminiExecutionService(
      provider,
      configuration,
      sequenceClock([
        '2026-07-30T18:00:01.000Z',
        '2026-07-30T18:00:02.000Z',
        '2026-07-30T18:00:03.000Z',
        '2026-07-30T18:00:04.000Z',
        '2026-07-30T18:00:05.000Z',
        '2026-07-30T18:00:08.000Z',
      ]),
    );
    const output = await service.execute(execution);
    expect(output.executionResult.status).toBe('COMPLETED');
    expect(output.structuredOutput).toMatchObject({ summary: 'Completed.' });
  });
});
