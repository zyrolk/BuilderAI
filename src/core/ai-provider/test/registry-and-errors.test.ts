import {
  AIProviderRegistry,
  InvalidProviderConfigurationError,
  ProviderCancelledError,
  ProviderCompatibilityService,
  ProviderContractViolationError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  UnsupportedCapabilityError,
} from '..';
import {
  createConfiguration,
  createDescriptor,
  createProvider,
  createRequest,
} from './ai-provider.fixture';

describe('AI provider registry and compatibility', () => {
  it('discovers enabled providers in deterministic priority order', () => {
    const registry = new AIProviderRegistry();
    registry.register(
      createProvider(createDescriptor('provider-low')),
      createConfiguration('provider-low', { priority: 1 }),
    );
    registry.register(
      createProvider(createDescriptor('provider-high')),
      createConfiguration('provider-high', { priority: 20 }),
    );
    registry.register(
      createProvider(createDescriptor('provider-disabled')),
      createConfiguration('provider-disabled', { enabled: false, priority: 100 }),
    );

    expect(registry.list().map(({ id }) => id)).toEqual(['provider-high', 'provider-low']);
    expect(registry.resolve('provider-high').descriptor.id).toBe('provider-high');
    expect(() => registry.resolve('provider-disabled')).toThrow(ProviderUnavailableError);
  });

  it('rejects duplicate, mismatched, and impossible registrations', () => {
    const registry = new AIProviderRegistry();
    const provider = createProvider();
    registry.register(provider, createConfiguration());
    expect(() => registry.register(provider, createConfiguration())).toThrow(
      InvalidProviderConfigurationError,
    );
    expect(() =>
      new AIProviderRegistry().register(provider, createConfiguration('provider-other')),
    ).toThrow(InvalidProviderConfigurationError);
    expect(() =>
      new AIProviderRegistry().register(
        createProvider(createDescriptor('provider-no-stream', { streaming: false })),
        createConfiguration('provider-no-stream', { requiredCapabilities: ['STREAMING'] }),
      ),
    ).toThrow(InvalidProviderConfigurationError);
  });

  it('rejects provider descriptor drift after registration', () => {
    const descriptor = createDescriptor();
    const provider = createProvider(descriptor);
    const registry = new AIProviderRegistry();
    registry.register(provider, createConfiguration());
    (descriptor.capabilities as { streaming: boolean }).streaming = true;

    expect(() => registry.resolve('provider-alpha')).toThrow(ProviderContractViolationError);
  });

  it('filters providers by request capabilities, limits, modes, and timeout', async () => {
    const request = await createRequest();
    const registry = new AIProviderRegistry();
    registry.register(createProvider(), createConfiguration());
    registry.register(
      createProvider(createDescriptor('provider-small', { maximumContextCharacters: 1 })),
      createConfiguration('provider-small'),
    );
    registry.register(
      createProvider(createDescriptor('provider-timeout')),
      createConfiguration('provider-timeout', { maximumTimeoutMs: 100, defaultTimeoutMs: 100 }),
    );

    expect(registry.findCompatible(request).map(({ id }) => id)).toEqual(['provider-alpha']);
    expect(registry.unregister('provider-alpha')).toBe(true);
    expect(registry.has('provider-alpha')).toBe(false);
  });

  it('reports unsupported request capabilities with a typed error', async () => {
    const request = await createRequest({
      executionMode: 'STREAMING',
      constraints: {
        maximumOutputCharacters: 1_000,
        requiredArtifactKinds: ['IMAGE'],
        requiredCapabilities: ['TOOL_CALLING'],
        requireStructuredResponse: false,
      },
    });
    const descriptor = createDescriptor('provider-limited', {
      streaming: false,
      toolCalling: false,
      imageSupport: false,
    });
    const configuration = createConfiguration('provider-limited', {
      allowedExecutionModes: ['SINGLE_RESPONSE', 'STREAMING'],
    });
    const service = new ProviderCompatibilityService();

    expect(() => service.assertCapabilities(descriptor, configuration, request)).toThrow(
      UnsupportedCapabilityError,
    );
    expect(service.evaluate(descriptor, configuration, request).compatible).toBe(false);
  });

  it('evaluates every artifact capability and non-capability compatibility reason', async () => {
    const request = await createRequest({
      executionMode: 'STREAMING',
      timeoutMs: 2_000,
      constraints: {
        maximumOutputCharacters: 1_000,
        requiredArtifactKinds: ['STRUCTURED_DATA', 'FILE', 'IMAGE'],
        requiredCapabilities: ['REASONING'],
        requireStructuredResponse: true,
      },
    });
    const descriptor = createDescriptor('provider-complete', {
      streaming: true,
      toolCalling: true,
      imageSupport: true,
    });
    const configuration = createConfiguration('provider-complete', {
      enabled: false,
      maximumTimeoutMs: 1_000,
      allowedExecutionModes: ['SINGLE_RESPONSE'],
      requiredCapabilities: [
        'CONTEXT_INGESTION',
        'STRUCTURED_OUTPUT',
        'STREAMING',
        'TOOL_CALLING',
        'REASONING',
        'FILE_SUPPORT',
        'IMAGE_SUPPORT',
        'STRUCTURED_RESPONSES',
      ],
    });
    const result = new ProviderCompatibilityService().evaluate(descriptor, configuration, request);

    expect(result.missingCapabilities).toEqual([]);
    expect(result.reasons).toEqual([
      'DISABLED',
      'EXECUTION_MODE_NOT_ALLOWED',
      'TIMEOUT_LIMIT_EXCEEDED',
    ]);
  });
});

describe('AI provider error taxonomy', () => {
  it('retains typed codes and diagnostic fields without leaking provider internals', () => {
    expect(new ProviderTimeoutError('provider-alpha', 100).code).toBe('TIMEOUT');
    expect(new ProviderCancelledError('request-one', 'user request').code).toBe('CANCELLED');
    expect(new ProviderUnavailableError('provider-alpha').providerId).toBe('provider-alpha');
    expect(
      new ProviderContractViolationError('RESPONSE', [{ path: '$', message: 'invalid' }]).code,
    ).toBe('CONTRACT_VIOLATION');
  });
});
