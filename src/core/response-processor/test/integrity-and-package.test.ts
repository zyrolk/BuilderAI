import { ResponseIntegrityService, ResponseProcessorService } from '../services';
import { ResponseProcessorValidationError } from '../types';
import { ResponsePackageValidator } from '../validators';
import {
  createProcessingInput,
  createResponseProcessorConfiguration,
  TestChecksumPort,
} from './response-processor.fixture';

describe('Response Package validation and integrity', () => {
  const configuration = createResponseProcessorConfiguration();
  const checksum = new TestChecksumPort();

  it('accepts a complete deterministic Response Package', async () => {
    const packageValue = await new ResponseProcessorService(configuration, checksum).process(
      createProcessingInput(),
    );
    const validator: ResponsePackageValidator = new ResponsePackageValidator(configuration);
    expect(() => validator.validate(packageValue)).not.toThrow();
    await expect(
      new ResponseIntegrityService(configuration, checksum).verify(packageValue),
    ).resolves.toBeUndefined();
  });

  it('rejects unsupported package and manifest versions', async () => {
    const packageValue = await new ResponseProcessorService(configuration, checksum).process(
      createProcessingInput(),
    );
    const validator: ResponsePackageValidator = new ResponsePackageValidator(configuration);
    expect(() => validator.validate({ ...packageValue, schemaVersion: 2 })).toThrow(
      ResponseProcessorValidationError,
    );
    expect(() =>
      validator.validate({
        ...packageValue,
        manifest: { ...packageValue.manifest, schemaVersion: 2 },
      }),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('detects content checksum and size tampering', async () => {
    const packageValue = await new ResponseProcessorService(configuration, checksum).process(
      createProcessingInput(),
    );
    const tampered = {
      ...packageValue,
      generatedArtifacts: packageValue.generatedArtifacts.map((artifact) => ({
        ...artifact,
        content: `${artifact.content}tampered`,
      })),
    };
    await expect(
      new ResponseIntegrityService(configuration, checksum).verify(tampered),
    ).rejects.toBeInstanceOf(ResponseProcessorValidationError);
  });

  it('detects manifest identity, metadata, entry-count, and total-size drift', async () => {
    const packageValue = await new ResponseProcessorService(configuration, checksum).process(
      createProcessingInput(),
    );
    const entry = packageValue.manifest.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const service = new ResponseIntegrityService(configuration, checksum);
    await expect(
      service.verify({
        ...packageValue,
        manifest: {
          ...packageValue.manifest,
          entries: [{ ...entry, type: 'TEST', metadata: { description: 'different' } }],
          totalSizeBytes: packageValue.manifest.totalSizeBytes + 1,
        },
      }),
    ).rejects.toBeInstanceOf(ResponseProcessorValidationError);
    await expect(
      service.verify({
        ...packageValue,
        manifest: { ...packageValue.manifest, entries: [] },
      }),
    ).rejects.toBeInstanceOf(ResponseProcessorValidationError);
  });

  it('rejects noncanonical artifact and metadata ordering', async () => {
    const input = createProcessingInput([
      {
        logicalPath: 'b.ts',
        type: 'SOURCE_FILE',
        content: 'b',
        metadata: { description: 'b' },
      },
      {
        logicalPath: 'a.ts',
        type: 'SOURCE_FILE',
        content: 'a',
        metadata: { description: 'a' },
      },
    ]);
    const packageValue = await new ResponseProcessorService(configuration, checksum).process(input);
    const validator: ResponsePackageValidator = new ResponsePackageValidator(configuration);
    expect(() =>
      validator.validate({
        ...packageValue,
        generatedArtifacts: [...packageValue.generatedArtifacts].reverse(),
      }),
    ).toThrow(ResponseProcessorValidationError);
  });

  it('returns typed issues for malformed arrays and independently invalid manifests', async () => {
    const packageValue = await new ResponseProcessorService(configuration, checksum).process(
      createProcessingInput(),
    );
    const validator = new ResponsePackageValidator(configuration);
    expect(() => validator.validate({ ...packageValue, diagnostics: null })).toThrow(
      ResponseProcessorValidationError,
    );
    expect(() =>
      validator.validate({
        ...packageValue,
        manifest: {
          ...packageValue.manifest,
          entries: [{ ...packageValue.manifest.entries[0], logicalPath: '../escape.ts' }],
        },
      }),
    ).toThrow(ResponseProcessorValidationError);
  });
});
