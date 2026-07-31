import {
  ArtifactManifestService,
  ResponseNormalizationService,
  Sha256ChecksumService,
} from '../services';
import { ResponseProcessorValidationError } from '../types';
import {
  createGeneratedArtifact,
  createProcessingInput,
  createResponseProcessorConfiguration,
  TestChecksumPort,
} from './response-processor.fixture';

describe('response normalization and manifest generation', () => {
  it('normalizes line endings, artifact order, diagnostics, warnings, and metadata', () => {
    const service = new ResponseNormalizationService();
    const artifacts = service.normalizeArtifacts([
      createGeneratedArtifact({
        logicalPath: 'z.ts',
        content: 'a\r\nb\r',
        metadata: { zeta: 'x\r', description: 'z' },
      }),
      createGeneratedArtifact({
        logicalPath: 'a.ts',
        metadata: { language: 'ts', description: 'a' },
      }),
    ]);
    expect(artifacts.map(({ logicalPath }) => logicalPath)).toEqual(['a.ts', 'z.ts']);
    expect(artifacts[1]?.content).toBe('a\nb\n');
    expect(Object.keys(artifacts[0]?.metadata ?? {})).toEqual(['description', 'language']);

    const input = createProcessingInput();
    expect(
      service.normalizeDiagnostics(input.providerResponse.diagnostics).map(({ code }) => code),
    ).toEqual(['ALPHA', 'ZETA']);
    expect(
      service.normalizeWarnings(input.providerResponse.warnings).map(({ code }) => code),
    ).toEqual(['ALPHA_WARNING', 'ZETA_WARNING']);
    expect(service.normalizeWarnings(input.providerResponse.warnings)[0]?.message).toBe(
      'Earlier\n',
    );
    expect(Object.keys(service.mergeMetadata(input))).toEqual([
      'execution-policy',
      'provider-id',
      'shared',
    ]);
  });

  it('generates a deterministic manifest from normalized UTF-8 content', async () => {
    const configuration = createResponseProcessorConfiguration();
    const checksum = new TestChecksumPort();
    const service = new ArtifactManifestService(configuration, checksum);
    const artifact = createGeneratedArtifact({ logicalPath: 'z.ts', content: 'é\r\n' });
    const other = createGeneratedArtifact({ logicalPath: 'a.ts', content: 'a' });
    const first = await service.generate([artifact, other]);
    const second = await service.generate([structuredClone(other), structuredClone(artifact)]);
    expect(first).toEqual(second);
    expect(first.entries[1]).toMatchObject({
      logicalPath: 'z.ts',
      type: 'SOURCE_FILE',
      sizeBytes: 3,
      checksum: { algorithm: 'test-checksum' },
    });
    expect(first.totalSizeBytes).toBe(4);
  });

  it('rejects a checksum port mismatch or invalid checksum output', async () => {
    const configuration = createResponseProcessorConfiguration();
    expect(
      () =>
        new ArtifactManifestService(configuration, {
          algorithm: 'other',
          checksum: async () => 'aaaa',
        }),
    ).toThrow(ResponseProcessorValidationError);
    const service = new ArtifactManifestService(configuration, {
      algorithm: 'test-checksum',
      checksum: async () => 'NOT HEX',
    });
    await expect(service.generate([createGeneratedArtifact()])).rejects.toBeInstanceOf(
      ResponseProcessorValidationError,
    );
  });

  it('calculates the standard SHA-256 checksum without signing', async () => {
    await expect(new Sha256ChecksumService().checksum('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
