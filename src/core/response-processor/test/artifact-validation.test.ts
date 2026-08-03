import { ResponseProcessorValidationError } from '../types';
import { GeneratedArtifactValidator } from '../validators';
import {
  createGeneratedArtifact,
  createResponseProcessorConfiguration,
} from './response-processor.fixture';

describe('GeneratedArtifactValidator', () => {
  const validator: GeneratedArtifactValidator = new GeneratedArtifactValidator(
    createResponseProcessorConfiguration(),
  );

  it('accepts the four closed artifact types', () => {
    const artifacts = [
      createGeneratedArtifact({ logicalPath: 'src/a.ts', type: 'SOURCE_FILE' }),
      createGeneratedArtifact({ logicalPath: 'docs/a.md', type: 'DOCUMENTATION' }),
      createGeneratedArtifact({ logicalPath: 'config/a.json', type: 'CONFIGURATION' }),
      createGeneratedArtifact({ logicalPath: 'test/a.test.ts', type: 'TEST' }),
    ];
    expect(() => validator.validate(artifacts)).not.toThrow();
  });

  it('rejects unsupported artifact types and unknown fields', () => {
    expect(() =>
      validator.validate([{ ...createGeneratedArtifact(), type: 'BINARY', executable: true }]),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('rejects PATCH as no longer a supported artifact type', () => {
    expect(() =>
      validator.validate([
        { ...createGeneratedArtifact({ logicalPath: 'patches/a.patch' }), type: 'PATCH' },
      ]),
    ).toThrow(ResponseProcessorValidationError);
  });

  it.each([
    '../outside.ts',
    '/absolute.ts',
    'C:/absolute.ts',
    'src\\windows.ts',
    'src//empty.ts',
    './relative.ts',
    ' src/space.ts',
    'src/trailing. ',
    'src/control\n.ts',
  ])('rejects unsafe logical path %s', (logicalPath) => {
    expect(() => validator.validate([createGeneratedArtifact({ logicalPath })])).toThrow(
      ResponseProcessorValidationError,
    );
  });

  it('rejects exact and case-insensitive duplicate paths', () => {
    expect(() =>
      validator.validate([
        createGeneratedArtifact({ logicalPath: 'src/file.ts' }),
        createGeneratedArtifact({ logicalPath: 'SRC/FILE.ts' }),
      ]),
    ).toThrowError(expect.objectContaining({ code: 'RESPONSE_PROCESSOR_VALIDATION_FAILED' }));
  });

  it('rejects missing required, non-scalar, excessive, and malformed metadata', () => {
    expect(() => validator.validate([createGeneratedArtifact({ metadata: {} })])).toThrow(
      ResponseProcessorValidationError,
    );
    expect(() =>
      validator.validate([
        createGeneratedArtifact({
          metadata: { description: 'valid', nested: { value: true } } as never,
        }),
      ]),
    ).toThrow(ResponseProcessorValidationError);
    expect(() =>
      validator.validate([
        createGeneratedArtifact({ metadata: { description: 'valid', Invalid_Key: true } }),
      ]),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('enforces artifact count, individual byte size, and total byte size', () => {
    const countValidator = new GeneratedArtifactValidator(
      createResponseProcessorConfiguration({ maximumArtifacts: 1 }),
    );
    expect(() =>
      countValidator.validate([
        createGeneratedArtifact({ logicalPath: 'a.ts' }),
        createGeneratedArtifact({ logicalPath: 'b.ts' }),
      ]),
    ).toThrow(ResponseProcessorValidationError);

    const sizeValidator = new GeneratedArtifactValidator(
      createResponseProcessorConfiguration({ maximumArtifactBytes: 4, maximumTotalBytes: 5 }),
    );
    expect(() => sizeValidator.validate([createGeneratedArtifact({ content: 'ééé' })])).toThrow(
      ResponseProcessorValidationError,
    );
  });
});
