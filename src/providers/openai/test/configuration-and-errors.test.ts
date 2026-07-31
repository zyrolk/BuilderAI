import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  BadRequestError,
} from 'openai';
import {
  InvalidProviderConfigurationError,
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import { OpenAIErrorMapper, OpenAISdkResponsesClient } from '../adapter';
import { toCoreProviderConfiguration } from '../config';
import { OpenAIConfigurationValidator, OpenAICredentialsValidator } from '../validators';
import { createOpenAIConfiguration } from './openai-provider.fixture';

describe('OpenAI configuration and error mapping', () => {
  const configurationValidator: OpenAIConfigurationValidator = new OpenAIConfigurationValidator();
  const credentialsValidator: OpenAICredentialsValidator = new OpenAICredentialsValidator();
  const mapper = new OpenAIErrorMapper();

  it('validates configuration and maps it to the core policy', () => {
    const configuration = createOpenAIConfiguration();
    expect(() => configurationValidator.validate(configuration)).not.toThrow();
    expect(toCoreProviderConfiguration(configuration)).toMatchObject({
      providerId: 'openai-responses',
      enabled: true,
      allowedExecutionModes: ['SINGLE_RESPONSE'],
    });
  });

  it.each([
    { model: '' },
    { model: 'invalid model' },
    { defaultTimeoutMs: 0 },
    { maximumOutputTokens: -1 },
    { defaultTimeoutMs: 2_000, maximumTimeoutMs: 1_000 },
    { extra: true },
  ])('rejects invalid configuration %#', (override) => {
    expect(() =>
      configurationValidator.validate({ ...createOpenAIConfiguration(), ...override }),
    ).toThrow(InvalidProviderConfigurationError);
  });

  it('requires explicitly injected credentials and rejects extra credential fields', () => {
    expect(() => credentialsValidator.validate({ apiKey: 'test-secret' })).not.toThrow();
    expect(() => credentialsValidator.validate({ apiKey: '' })).toThrow(
      InvalidProviderConfigurationError,
    );
    expect(() =>
      credentialsValidator.validate({ apiKey: 'secret', organization: 'hidden' }),
    ).toThrow(InvalidProviderConfigurationError);
  });

  it('maps cancellation and timeout errors', () => {
    expect(mapper.map(new APIUserAbortError(), 'request-one', 100, 'stopped')).toBeInstanceOf(
      ProviderCancelledError,
    );
    expect(mapper.map(new APIConnectionTimeoutError(), 'request-one', 100)).toBeInstanceOf(
      ProviderTimeoutError,
    );
    const abort = new Error('abort');
    abort.name = 'AbortError';
    expect(mapper.map(abort, 'request-one', 100)).toBeInstanceOf(ProviderCancelledError);
  });

  it('maps connection, throttling, and server errors to provider unavailable', () => {
    expect(
      mapper.map(new APIConnectionError({ message: 'offline' }), 'request-one', 100),
    ).toBeInstanceOf(ProviderUnavailableError);
    expect(mapper.map({ status: 429 }, 'request-one', 100)).toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(mapper.map({ status: 503 }, 'request-one', 100)).toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(mapper.map(new Error('unknown'), 'request-one', 100)).toBeInstanceOf(
      ProviderUnavailableError,
    );
  });

  it('maps provider request rejections without exposing the provider payload', () => {
    const headers = new Headers();
    const error = new BadRequestError(400, { secret: 'must-not-leak' }, 'bad', headers);
    const mapped = mapper.map(error, 'request-one', 100);
    expect(mapped).toBeInstanceOf(ProviderContractViolationError);
    expect(mapped.message).toContain('status 400');
    expect(mapped.message).not.toContain('must-not-leak');
  });

  it('maps rejected credentials or model access to invalid configuration', () => {
    expect(mapper.map({ status: 401 }, 'request-one', 100)).toBeInstanceOf(
      InvalidProviderConfigurationError,
    );
    expect(mapper.map({ status: 404 }, 'request-one', 100)).toBeInstanceOf(
      InvalidProviderConfigurationError,
    );
  });

  it('preserves errors already expressed in the BuilderAI taxonomy', () => {
    const existing = new ProviderUnavailableError('openai-responses');
    expect(mapper.map(existing, 'request-one', 100)).toBe(existing);
  });

  it('configures the official SDK with retries disabled and forwards request controls', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'response' });
    const factory = vi.fn(() => ({ responses: { create } }));
    const client = new OpenAISdkResponsesClient(
      { apiKey: 'explicit-test-secret' },
      createOpenAIConfiguration(),
      factory,
    );
    const controller = new AbortController();
    const request = {
      model: 'test-model',
      input: '{}',
      stream: false,
      background: false,
      store: false,
      truncation: 'disabled',
      parallel_tool_calls: false,
      max_output_tokens: 10,
      text: {
        format: {
          type: 'json_schema',
          name: 'builderai_response',
          description: 'test',
          strict: false,
          schema: { type: 'object' },
        },
      },
    } as const;
    await expect(
      client.create(request, { timeoutMs: 250, signal: controller.signal }),
    ).resolves.toEqual({ id: 'response' });
    expect(factory).toHaveBeenCalledWith({
      apiKey: 'explicit-test-secret',
      timeout: 1_000,
      maxRetries: 0,
    });
    expect(create).toHaveBeenCalledWith(request, {
      timeout: 250,
      signal: controller.signal,
      maxRetries: 0,
    });
  });
});
