import {
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import { createExecutionRequest } from '../../../core/execution-engine/test/execution-engine.fixture';
import { TruncationRetryCompactionService } from '../../../core/prompt-orchestrator';
import { OpenRouterProvider } from '../adapter';
import { OpenRouterExecutionRequestMapper } from '../mapper';
import { OpenRouterExecutionService } from '../services';
import {
  createOpenRouterConfiguration,
  createOpenRouterRequest,
  FakeOpenRouterChatClient,
  sequenceClock,
} from './openrouter-provider.fixture';

describe('OpenRouter provider contract enforcement', () => {
  it('declares only implemented capabilities and executes exactly one request', async () => {
    const client = new FakeOpenRouterChatClient();
    const provider = new OpenRouterProvider(
      createOpenRouterConfiguration(),
      client,
      sequenceClock(['2026-07-30T16:00:00.000Z', '2026-07-30T16:00:01.000Z']),
    );
    const response = await provider.execute(await createOpenRouterRequest());
    expect(client.calls).toHaveLength(1);
    expect(response.status).toBe('COMPLETED');
    expect(client.calls[0]?.request.response_format.type).toBe('json_schema');
    expect(provider.descriptor.capabilities).toMatchObject({
      streaming: false,
      toolCalling: false,
      fileSupport: false,
      imageSupport: false,
      structuredResponses: true,
    });
  });

  it('rejects pre-request cancellation without calling the provider', async () => {
    const client = new FakeOpenRouterChatClient();
    const provider = new OpenRouterProvider(createOpenRouterConfiguration(), client);
    const request = await createOpenRouterRequest({
      cancellation: { cancelled: true, reason: 'user stop', subscribe: () => () => undefined },
    });
    await expect(provider.execute(request)).rejects.toBeInstanceOf(ProviderCancelledError);
    expect(client.calls).toHaveLength(0);
  });

  it('bridges cancellation and always releases the subscription', async () => {
    let listener: ((reason?: string) => void) | undefined;
    const unsubscribe = vi.fn();
    const client = new FakeOpenRouterChatClient(
      undefined,
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    );
    const provider = new OpenRouterProvider(createOpenRouterConfiguration(), client);
    const request = await createOpenRouterRequest({
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

  it('does not retry provider failures at the adapter layer', async () => {
    const client = new FakeOpenRouterChatClient(undefined, new Error('offline'));
    const provider = new OpenRouterProvider(createOpenRouterConfiguration(), client);
    await expect(provider.execute(await createOpenRouterRequest())).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(client.calls).toHaveLength(1);
  });

  it('maps execution requests to provider requests with bounded attempt metadata', async () => {
    const executionRequest = await createExecutionRequest();
    const configuration = createOpenRouterConfiguration();
    const attemptResolution = new TruncationRetryCompactionService().resolveAttempt({
      prompt: executionRequest.prompt,
      attempt: 2,
    });
    const mapped = new OpenRouterExecutionRequestMapper().map(
      executionRequest,
      configuration,
      2,
      5_000,
      attemptResolution,
    );
    expect(mapped.requestId).toBe(executionRequest.executionId);
    expect(mapped.prompt).toBe(executionRequest.prompt);
    expect(mapped.timeoutMs).toBe(5_000);
    expect(mapped.metadata).toMatchObject({ attempt: 2 });
  });

  it('returns structured output through the execution service', async () => {
    const client = new FakeOpenRouterChatClient();
    const configuration = createOpenRouterConfiguration();
    const provider = new OpenRouterProvider(
      configuration,
      client,
      sequenceClock(['2026-07-30T18:00:06.000Z', '2026-07-30T18:00:07.000Z']),
    );
    const service = new OpenRouterExecutionService(
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
    expect(output.structuredOutput).toMatchObject({
      summary: 'Completed.',
      artifacts: [],
      diagnostics: [],
    });
  });

  it('rejects policy-blocked finish reasons without exposing raw content in errors', async () => {
    const client = new FakeOpenRouterChatClient({
      id: 'chatcmpl-bad',
      model: 'test/openrouter-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: '{"secret":"must-not-leak"}' },
          finish_reason: 'content_filter',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const provider = new OpenRouterProvider(createOpenRouterConfiguration(), client);
    const error = await provider.execute(await createOpenRouterRequest()).catch((caught) => caught);
    expect(error).toBeInstanceOf(ProviderContractViolationError);
    expect(String(error.message)).not.toContain('must-not-leak');
  });
});
