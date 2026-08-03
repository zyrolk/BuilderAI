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
import { OpenRouterErrorMapper, OpenRouterSdkChatClient } from '../adapter';
import { toCoreProviderConfiguration } from '../config';
import { OpenRouterConfigurationValidator, OpenRouterCredentialsValidator } from '../validators';
import {
  createOpenRouterConfiguration,
  createOpenRouterCredentials,
} from './openrouter-provider.fixture';

describe('OpenRouter configuration and error mapping', () => {
  const configurationValidator: OpenRouterConfigurationValidator =
    new OpenRouterConfigurationValidator();
  const credentialsValidator: OpenRouterCredentialsValidator = new OpenRouterCredentialsValidator();
  const mapper = new OpenRouterErrorMapper();

  it('validates configuration and maps it to the core policy', () => {
    const configuration = createOpenRouterConfiguration();
    expect(() => configurationValidator.validate(configuration)).not.toThrow();
    expect(toCoreProviderConfiguration(configuration)).toMatchObject({
      providerId: 'openrouter-chat',
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
      configurationValidator.validate({ ...createOpenRouterConfiguration(), ...override }),
    ).toThrow(InvalidProviderConfigurationError);
  });

  it('requires explicitly injected credentials and rejects extra credential fields', () => {
    expect(() => credentialsValidator.validate(createOpenRouterCredentials())).not.toThrow();
    expect(() =>
      credentialsValidator.validate({ apiKey: '', baseUrl: 'https://openrouter.ai/api/v1' }),
    ).toThrow(InvalidProviderConfigurationError);
    expect(() =>
      credentialsValidator.validate({
        apiKey: 'secret',
        baseUrl: 'https://openrouter.ai/api/v1',
        organization: 'hidden',
      }),
    ).toThrow(InvalidProviderConfigurationError);
  });

  it('rejects missing or invalid baseUrl', () => {
    expect(() => credentialsValidator.validate({ apiKey: 'secret', baseUrl: '' })).toThrow(
      InvalidProviderConfigurationError,
    );
    expect(() => credentialsValidator.validate({ apiKey: 'secret', baseUrl: 'not-a-url' })).toThrow(
      InvalidProviderConfigurationError,
    );
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
    expect(mapper.map({ status: 403 }, 'request-one', 100)).toBeInstanceOf(
      InvalidProviderConfigurationError,
    );
    expect(mapper.map({ status: 404 }, 'request-one', 100)).toBeInstanceOf(
      InvalidProviderConfigurationError,
    );
  });

  it('preserves errors already expressed in the BuilderAI taxonomy', () => {
    const existing = new ProviderUnavailableError('openrouter-chat');
    expect(mapper.map(existing, 'request-one', 100)).toBe(existing);
  });

  it('configures the OpenAI SDK for OpenRouter with retries disabled and forwards request controls', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'chatcmpl-test' });
    const factory = vi.fn(() => ({ chat: { completions: { create } } }));
    const client = new OpenRouterSdkChatClient(
      createOpenRouterCredentials(),
      createOpenRouterConfiguration(),
      factory,
    );
    const controller = new AbortController();
    const request = {
      model: 'test/openrouter-model',
      messages: [{ role: 'user', content: '{}' }],
      max_tokens: 10,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'builderai_response',
          description: 'test',
          strict: false,
          schema: { type: 'object' },
        },
      },
    } as const;
    await expect(
      client.create(request, { timeoutMs: 250, signal: controller.signal }),
    ).resolves.toEqual({ id: 'chatcmpl-test' });
    expect(factory).toHaveBeenCalledWith({
      apiKey: 'openrouter-test-secret',
      baseURL: 'https://openrouter.ai/api/v1',
      timeout: 1_000,
      maxRetries: 0,
    });
    expect(create).toHaveBeenCalledWith(request, {
      timeout: 250,
      signal: controller.signal,
      maxRetries: 0,
    });
  });

  it('forwards optional OpenRouter attribution headers when configured', () => {
    const factory = vi.fn(() => ({ chat: { completions: { create: vi.fn() } } }));
    new OpenRouterSdkChatClient(
      createOpenRouterCredentials({
        httpReferer: 'https://builderai.local',
        appTitle: 'BuilderAI',
      }),
      createOpenRouterConfiguration(),
      factory,
    );
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHeaders: {
          'HTTP-Referer': 'https://builderai.local',
          'X-Title': 'BuilderAI',
        },
      }),
    );
  });

  it('never includes the API key in mapped error messages', () => {
    const headers = new Headers();
    const error = new BadRequestError(
      400,
      { api_key: 'sk-live-must-not-leak' },
      'bad request',
      headers,
    );
    const mapped = mapper.map(error, 'request-one', 100);
    expect(mapped.message).not.toContain('sk-live-must-not-leak');
  });
});
