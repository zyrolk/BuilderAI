import {
  InvalidProviderConfigurationError,
  ProviderCapabilityValidator,
  ProviderConfigurationValidator,
  ProviderContractViolationError,
  ProviderDescriptorValidator,
} from '..';
import { createCapabilities, createConfiguration, createDescriptor } from './ai-provider.fixture';

describe('provider capability and configuration validation', () => {
  it('accepts complete provider-neutral capabilities and descriptors', () => {
    expect(() => new ProviderCapabilityValidator().validate(createCapabilities())).not.toThrow();
    expect(() => new ProviderDescriptorValidator().validate(createDescriptor())).not.toThrow();
  });

  it('rejects malformed capability flags and context limits', () => {
    expect(() =>
      new ProviderCapabilityValidator().validate({
        ...createCapabilities(),
        streaming: 'sometimes',
        maximumContextCharacters: 0,
      }),
    ).toThrow(ProviderContractViolationError);
  });

  it('rejects descriptor version and identity violations', () => {
    const descriptor = { ...createDescriptor(), contractVersion: 2, id: 'Invalid ID' };
    expect(() => new ProviderDescriptorValidator().validate(descriptor)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('accepts provider-independent configuration', () => {
    expect(() =>
      new ProviderConfigurationValidator().validate(createConfiguration()),
    ).not.toThrow();
  });

  it('rejects invalid timeouts, execution modes, and duplicate requirements', () => {
    const configuration = {
      ...createConfiguration(),
      defaultTimeoutMs: 6_000,
      allowedExecutionModes: [],
      requiredCapabilities: ['REASONING', 'REASONING'],
    };
    expect(() => new ProviderConfigurationValidator().validate(configuration)).toThrow(
      InvalidProviderConfigurationError,
    );
  });

  it('rejects undeclared configuration fields such as credentials or endpoints', () => {
    const configuration = {
      ...createConfiguration(),
      apiKey: 'must-not-enter-core',
      endpoint: 'must-not-enter-core',
    };
    expect(() => new ProviderConfigurationValidator().validate(configuration)).toThrow(
      InvalidProviderConfigurationError,
    );
  });

  it('rejects non-object capability, descriptor, and configuration inputs', () => {
    expect(() => new ProviderCapabilityValidator().validate(null)).toThrow(
      ProviderContractViolationError,
    );
    expect(() => new ProviderDescriptorValidator().validate('provider')).toThrow(
      ProviderContractViolationError,
    );
    expect(() => new ProviderConfigurationValidator().validate([])).toThrow(
      InvalidProviderConfigurationError,
    );
  });
});
