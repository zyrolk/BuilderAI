import { ResponseProcessorValidationError } from '../types';
import { ResponseProcessingInputValidator } from '../validators';
import {
  createGeneratedArtifact,
  createProcessingInput,
  createResponseProcessorConfiguration,
} from './response-processor.fixture';

describe('ResponseProcessingInputValidator', () => {
  const validator: ResponseProcessingInputValidator = new ResponseProcessingInputValidator(
    createResponseProcessorConfiguration(),
  );

  it('accepts correlated completed provider and execution results', () => {
    expect(() => validator.validate(createProcessingInput())).not.toThrow();
  });

  it('rejects malformed provider responses and execution results', () => {
    expect(() => validator.validate({ providerResponse: {}, executionResult: {} })).toThrow(
      ResponseProcessorValidationError,
    );
  });

  it('rejects non-completed responses and identity mismatch', () => {
    expect(() =>
      validator.validate(
        createProcessingInput(undefined, {
          executionResult: { executionId: 'execution-other' },
        }),
      ),
    ).toThrow(ResponseProcessorValidationError);
    expect(() =>
      validator.validate(
        createProcessingInput(undefined, {
          providerResponse: { status: 'PARTIAL' },
        }),
      ),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('rejects usage and provider-placeholder drift', () => {
    expect(() =>
      validator.validate(
        createProcessingInput(undefined, {
          executionResult: {
            usage: { promptCharacters: 901, outputCharacters: 100, estimated: false },
          },
        }),
      ),
    ).toThrow(ResponseProcessorValidationError);
    expect(() =>
      validator.validate(
        createProcessingInput(undefined, {
          executionResult: { artifacts: [] },
        }),
      ),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('requires exactly one structured artifact with an artifacts array', () => {
    const input = createProcessingInput();
    const textOnly = input.providerResponse.artifacts.filter(({ kind }) => kind === 'TEXT');
    expect(() =>
      validator.validate(
        createProcessingInput(undefined, {
          providerResponse: {
            artifacts: textOnly,
            usage: { ...input.providerResponse.usage, artifactCount: 1 },
          },
          executionResult: {
            artifacts: textOnly.map(({ id, name, kind }) => ({
              id,
              name,
              kind,
              state: 'PLACEHOLDER',
            })),
          },
        }),
      ),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('rejects conflicting or invalid supplemental metadata', () => {
    expect(() =>
      validator.validate(createProcessingInput(undefined, { metadata: { shared: 'different' } })),
    ).toThrow(ResponseProcessorValidationError);
    expect(() =>
      validator.validate(createProcessingInput(undefined, { metadata: { invalid_key: 'value' } })),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('does not validate nested generated artifacts before the artifact boundary', () => {
    const input = createProcessingInput([{ ...createGeneratedArtifact(), type: 'SOURCE_FILE' }]);
    expect(() => validator.validate(input)).not.toThrow();
  });
});
