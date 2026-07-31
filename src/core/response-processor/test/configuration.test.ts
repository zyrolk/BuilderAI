import { DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION } from '../config';
import { ResponseProcessorValidationError } from '../types';
import { ResponseProcessorConfigurationValidator } from '../validators';
import { createResponseProcessorConfiguration } from './response-processor.fixture';

describe('ResponseProcessorConfigurationValidator', () => {
  const validator = new ResponseProcessorConfigurationValidator();

  it('accepts the production defaults and a valid custom configuration', () => {
    expect(() => validator.validate(DEFAULT_RESPONSE_PROCESSOR_CONFIGURATION)).not.toThrow();
    expect(() => validator.validate(createResponseProcessorConfiguration())).not.toThrow();
  });

  it.each([
    null,
    { ...createResponseProcessorConfiguration(), maximumArtifacts: 0 },
    {
      ...createResponseProcessorConfiguration(),
      maximumArtifactBytes: 50_001,
      maximumTotalBytes: 50_000,
    },
    { ...createResponseProcessorConfiguration(), requiredArtifactMetadataKeys: 'description' },
    { ...createResponseProcessorConfiguration(), requiredArtifactMetadataKeys: [1] },
    { ...createResponseProcessorConfiguration(), requiredArtifactMetadataKeys: ['Invalid Key'] },
    {
      ...createResponseProcessorConfiguration(),
      requiredArtifactMetadataKeys: ['description', 'description'],
    },
    { ...createResponseProcessorConfiguration(), checksumAlgorithm: 'SHA 256' },
    { ...createResponseProcessorConfiguration(), unexpected: true },
  ])('rejects an invalid configuration %#', (configuration: unknown) => {
    expect(() => validator.validate(configuration)).toThrow(ResponseProcessorValidationError);
  });
});
