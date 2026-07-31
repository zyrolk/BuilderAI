import {
  InvalidProviderConfigurationError,
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import { GeminiErrorMapper, GeminiSdkClientAdapter } from '../adapter';
import { toCoreProviderConfiguration } from '../config';
import { GeminiConfigurationValidator, GeminiCredentialsValidator } from '../validators';
import { createGeminiConfiguration } from './gemini-provider.fixture';

describe('Gemini configuration, transport, and error mapping', () => {
  const configurationValidator: GeminiConfigurationValidator = new GeminiConfigurationValidator();
  const credentialsValidator: GeminiCredentialsValidator = new GeminiCredentialsValidator();
  const mapper = new GeminiErrorMapper();

  it('validates configuration and maps it to the unchanged core policy', () => {
    const configuration = createGeminiConfiguration();
    expect(() => configurationValidator.validate(configuration)).not.toThrow();
    expect(toCoreProviderConfiguration(configuration)).toMatchObject({
      providerId: 'google-gemini',
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
      configurationValidator.validate({ ...createGeminiConfiguration(), ...override }),
    ).toThrow(InvalidProviderConfigurationError);
  });

  it('requires explicitly injected credentials', () => {
    expect(() => credentialsValidator.validate({ apiKey: 'test-secret' })).not.toThrow();
    expect(() => credentialsValidator.validate({ apiKey: '' })).toThrow(
      InvalidProviderConfigurationError,
    );
    expect(() => credentialsValidator.validate({ apiKey: 'secret', extra: true })).toThrow(
      InvalidProviderConfigurationError,
    );
  });

  it('configures the official SDK with retries disabled and forwards request controls', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{}' });
    const factory = vi.fn(() => ({ models: { generateContent } }));
    const client = new GeminiSdkClientAdapter(
      { apiKey: 'explicit-test-secret' },
      createGeminiConfiguration(),
      factory,
    );
    const controller = new AbortController();
    const request = {
      model: 'gemini-test-model',
      contents: '{}',
      config: {
        candidateCount: 1,
        maxOutputTokens: 10,
        responseMimeType: 'application/json',
        responseJsonSchema: { type: 'object' },
        temperature: 0,
      },
    } as const;
    await client.generateContent(request, { timeoutMs: 250, signal: controller.signal });
    expect(factory).toHaveBeenCalledWith({
      apiKey: 'explicit-test-secret',
      httpOptions: { timeout: 1_000, retryOptions: { attempts: 1 } },
    });
    expect(generateContent).toHaveBeenCalledWith({
      ...request,
      config: {
        ...request.config,
        abortSignal: controller.signal,
        httpOptions: { timeout: 250, retryOptions: { attempts: 1 } },
      },
    });
  });

  it('maps provider failures into the existing error taxonomy without leaking payloads', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(mapper.map(abort, 'request-one', 100, 'stop')).toBeInstanceOf(ProviderCancelledError);
    expect(
      mapper.map(Object.assign(new Error('slow'), { name: 'TimeoutError' }), 'request-one', 100),
    ).toBeInstanceOf(ProviderTimeoutError);
    expect(mapper.map({ status: 429, secret: 'hidden' }, 'request-one', 100)).toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(mapper.map({ status: 503 }, 'request-one', 100)).toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(mapper.map({ status: 403 }, 'request-one', 100)).toBeInstanceOf(
      InvalidProviderConfigurationError,
    );
    const rejected = mapper.map({ status: 400, secret: 'hidden' }, 'request-one', 100);
    expect(rejected).toBeInstanceOf(ProviderContractViolationError);
    expect(rejected.message).not.toContain('hidden');
  });
});
