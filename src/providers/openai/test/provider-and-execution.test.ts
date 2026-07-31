import {
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import { createExecutionRequest } from '../../../core/execution-engine/test/execution-engine.fixture';
import { OpenAIProvider } from '../adapter';
import { OpenAIExecutionRequestMapper } from '../mapper';
import { OpenAIExecutionService } from '../services';
import {
  completedRawResponse,
  createOpenAIConfiguration,
  createOpenAIRequest,
  FakeOpenAIResponsesClient,
  sequenceClock,
} from './openai-provider.fixture';

describe('OpenAI provider contract enforcement', () => {
  it('declares only implemented capabilities and executes exactly one request', async () => {
    const client = new FakeOpenAIResponsesClient();
    const provider = new OpenAIProvider(
      createOpenAIConfiguration(),
      client,
      sequenceClock(['2026-07-30T16:00:00.000Z', '2026-07-30T16:00:01.000Z']),
    );
    const response = await provider.execute(await createOpenAIRequest());
    expect(client.calls).toHaveLength(1);
    expect(response.status).toBe('COMPLETED');
    expect(provider.descriptor.capabilities).toMatchObject({
      streaming: false,
      toolCalling: false,
      fileSupport: false,
      imageSupport: false,
      structuredResponses: true,
    });
  });

  it('rejects pre-request cancellation without calling the provider', async () => {
    const client = new FakeOpenAIResponsesClient();
    const provider = new OpenAIProvider(createOpenAIConfiguration(), client);
    const request = await createOpenAIRequest({
      cancellation: { cancelled: true, reason: 'user stop', subscribe: () => () => undefined },
    });
    await expect(provider.execute(request)).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(client.calls).toHaveLength(0);
  });

  it('bridges cancellation and always releases the subscription', async () => {
    let listener: ((reason?: string) => void) | undefined;
    const unsubscribe = vi.fn();
    const client = new FakeOpenAIResponsesClient(
      undefined,
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const provider = new OpenAIProvider(createOpenAIConfiguration(), client);
    const request = await createOpenAIRequest({
      cancellation: {
        cancelled: false,
        subscribe: (registered) => {
          listener = registered;
          return unsubscribe;
        },
      },
    });
    const promise = provider.execute(request);
    listener?.('late stop');
    await expect(promise).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(client.calls[0]?.options.signal.aborted).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not retry provider failures', async () => {
    const client = new FakeOpenAIResponsesClient(undefined, new Error('offline'));
    const provider = new OpenAIProvider(createOpenAIConfiguration(), client);
    await expect(provider.execute(await createOpenAIRequest())).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(client.calls).toHaveLength(1);
  });

  it('rejects responses that exceed the originating output limit', async () => {
    const output = JSON.stringify({
      summary: 'x'.repeat(1_000),
      artifacts: [],
      diagnostics: [],
    });
    const client = new FakeOpenAIResponsesClient(completedRawResponse(output));
    const provider = new OpenAIProvider(createOpenAIConfiguration(), client);
    const request = await createOpenAIRequest({
      constraints: {
        maximumOutputCharacters: 100,
        requiredArtifactKinds: ['STRUCTURED_DATA'],
        requiredCapabilities: [],
        requireStructuredResponse: true,
      },
    });
    await expect(provider.execute(request)).rejects.toBeInstanceOf(ProviderContractViolationError);
  });
});

describe('Execution Engine integration', () => {
  it('maps the Execution Request without changing its Prompt Package', async () => {
    const execution = await createExecutionRequest();
    const before = structuredClone(execution.prompt);
    const mapped = new OpenAIExecutionRequestMapper().map(
      execution,
      createOpenAIConfiguration(),
      2,
    );
    expect(execution.prompt).toEqual(before);
    expect(mapped.requestId).toBe(execution.executionId);
    expect(mapped.prompt).toBe(execution.prompt);
    expect(mapped.metadata).toMatchObject({ attempt: 2, 'correlation-id': 'sprint-six' });
    expect(mapped.executionMode).toBe('SINGLE_RESPONSE');
  });

  it('coordinates the existing state machine, provider, and validated result', async () => {
    const configuration = createOpenAIConfiguration();
    const provider = new OpenAIProvider(
      configuration,
      new FakeOpenAIResponsesClient(),
      sequenceClock(['2026-07-30T18:00:06.000Z', '2026-07-30T18:00:07.000Z']),
    );
    const service = new OpenAIExecutionService(
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
    const output = await service.execute(await createExecutionRequest());
    expect(output.executionResult.status).toBe('COMPLETED');
    expect(output.providerResponse.status).toBe('COMPLETED');
    expect(output.structuredOutput).toMatchObject({ summary: 'Completed.' });
    expect(output.executionResult.artifacts).toHaveLength(2);
  });
});
