import { ProviderContractViolationError, ProviderRequestValidator } from '..';
import { createRequest } from './ai-provider.fixture';

describe('provider request validation', () => {
  it('rejects a non-object request boundary', () => {
    expect(() => new ProviderRequestValidator().validate(null)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('accepts a valid request carrying the Prompt Package', async () => {
    const request = await createRequest();
    expect(() => new ProviderRequestValidator().validate(request)).not.toThrow();
  });

  it('rejects invalid cancellation metadata', async () => {
    const request = await createRequest({
      cancellation: { cancelled: true, reason: '', subscribe: () => () => undefined },
    });
    expect(() => new ProviderRequestValidator().validate(request)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('rejects malformed prompt and duplicate or unsupported constraints', async () => {
    const request = {
      ...(await createRequest()),
      prompt: { schemaVersion: 1 },
      constraints: {
        maximumOutputCharacters: 0,
        requiredArtifactKinds: ['TEXT', 'TEXT', 'AUDIO'],
        requiredCapabilities: ['STREAMING', 'STREAMING'],
        requireStructuredResponse: 'yes',
      },
    };
    expect(() => new ProviderRequestValidator().validate(request)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('rejects tampered Prompt Package budget metadata', async () => {
    const request = await createRequest();
    const invalid = {
      ...request,
      prompt: {
        ...request.prompt,
        budget: {
          ...request.prompt.budget,
          characters: request.prompt.budget.characters + 1,
        },
      },
    };
    expect(() => new ProviderRequestValidator().validate(invalid)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('rejects malformed constraints, cancellation, and metadata shapes', async () => {
    const request = {
      ...(await createRequest()),
      constraints: null,
      cancellation: null,
      metadata: null,
    };
    expect(() => new ProviderRequestValidator().validate(request)).toThrow(
      ProviderContractViolationError,
    );
  });
});
