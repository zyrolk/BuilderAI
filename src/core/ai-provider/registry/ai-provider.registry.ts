import type { AIProviderConfiguration } from '../config';
import type { AIProvider } from '../ports';
import { ProviderCompatibilityService } from '../services';
import {
  InvalidProviderConfigurationError,
  ProviderContractViolationError,
  ProviderUnavailableError,
  type AIProviderDescriptor,
  type AIProviderRequest,
} from '../types';
import {
  ProviderConfigurationValidator,
  ProviderDescriptorValidator,
  ProviderRequestValidator,
} from '../validators';

interface RegisteredProvider {
  readonly provider: AIProvider;
  readonly descriptor: AIProviderDescriptor;
  readonly configuration: AIProviderConfiguration;
}

export class AIProviderRegistry {
  private readonly providers = new Map<string, RegisteredProvider>();
  private readonly descriptorValidator: ProviderDescriptorValidator =
    new ProviderDescriptorValidator();
  private readonly configurationValidator: ProviderConfigurationValidator =
    new ProviderConfigurationValidator();
  private readonly requestValidator: ProviderRequestValidator = new ProviderRequestValidator();
  private readonly compatibility = new ProviderCompatibilityService();

  register(provider: AIProvider, configuration: AIProviderConfiguration): void {
    this.descriptorValidator.validate(provider.descriptor);
    this.configurationValidator.validate(configuration);

    if (provider.descriptor.id !== configuration.providerId) {
      throw new InvalidProviderConfigurationError([
        { path: '$.providerId', message: 'must match provider.descriptor.id' },
      ]);
    }
    if (this.providers.has(provider.descriptor.id)) {
      throw new InvalidProviderConfigurationError([
        {
          path: '$.providerId',
          message: `provider '${provider.descriptor.id}' is already registered`,
        },
      ]);
    }

    const missingConfigurationCapabilities = configuration.requiredCapabilities.filter(
      (capability) => !supportsCapability(provider.descriptor, capability),
    );
    if (missingConfigurationCapabilities.length > 0) {
      throw new InvalidProviderConfigurationError([
        {
          path: '$.requiredCapabilities',
          message: `provider does not support ${missingConfigurationCapabilities.join(', ')}`,
        },
      ]);
    }

    this.providers.set(provider.descriptor.id, {
      provider,
      descriptor: copyDescriptor(provider.descriptor),
      configuration: copyConfiguration(configuration),
    });
  }

  unregister(providerId: string): boolean {
    return this.providers.delete(providerId);
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  resolve(providerId: string): AIProvider {
    const registration = this.providers.get(providerId);
    if (registration === undefined || !registration.configuration.enabled) {
      throw new ProviderUnavailableError(providerId);
    }
    this.descriptorValidator.validate(registration.provider.descriptor);
    if (
      JSON.stringify(registration.provider.descriptor) !== JSON.stringify(registration.descriptor)
    ) {
      throw new ProviderContractViolationError('DESCRIPTOR', [
        { path: '$', message: 'changed after provider registration' },
      ]);
    }
    return registration.provider;
  }

  list(): readonly AIProviderDescriptor[] {
    return this.sortedRegistrations()
      .filter(({ configuration }) => configuration.enabled)
      .map(({ descriptor }) => copyDescriptor(descriptor));
  }

  findCompatible(request: AIProviderRequest): readonly AIProviderDescriptor[] {
    this.requestValidator.validate(request);
    return this.sortedRegistrations()
      .filter(
        ({ descriptor, configuration }) =>
          this.compatibility.evaluate(descriptor, configuration, request).compatible,
      )
      .map(({ descriptor }) => copyDescriptor(descriptor));
  }

  private sortedRegistrations(): readonly RegisteredProvider[] {
    return [...this.providers.values()].sort(
      (left, right) =>
        right.configuration.priority - left.configuration.priority ||
        left.descriptor.id.localeCompare(right.descriptor.id),
    );
  }
}

function supportsCapability(
  descriptor: AIProviderDescriptor,
  capability: AIProviderConfiguration['requiredCapabilities'][number],
): boolean {
  const { capabilities } = descriptor;
  switch (capability) {
    case 'CONTEXT_INGESTION':
      return capabilities.contextIngestion;
    case 'STRUCTURED_OUTPUT':
      return capabilities.structuredOutput;
    case 'STREAMING':
      return capabilities.streaming;
    case 'TOOL_CALLING':
      return capabilities.toolCalling;
    case 'REASONING':
      return capabilities.reasoning;
    case 'FILE_SUPPORT':
      return capabilities.fileSupport;
    case 'IMAGE_SUPPORT':
      return capabilities.imageSupport;
    case 'STRUCTURED_RESPONSES':
      return capabilities.structuredResponses;
  }
}

function copyDescriptor(descriptor: AIProviderDescriptor): AIProviderDescriptor {
  return {
    ...descriptor,
    capabilities: { ...descriptor.capabilities },
  };
}

function copyConfiguration(configuration: AIProviderConfiguration): AIProviderConfiguration {
  return {
    ...configuration,
    allowedExecutionModes: [...configuration.allowedExecutionModes],
    requiredCapabilities: [...configuration.requiredCapabilities],
  };
}
