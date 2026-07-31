import { ResponseProcessorService } from '../services';
import { ResponseProcessorValidationError } from '../types';
import {
  createGeneratedArtifact,
  createProcessingInput,
  createResponseProcessorConfiguration,
  TestChecksumPort,
} from './response-processor.fixture';

describe('ResponseProcessorService', () => {
  const configuration = createResponseProcessorConfiguration();
  const checksum = new TestChecksumPort();

  it('transforms validated response data into one deterministic Response Package', async () => {
    const input = createProcessingInput([
      createGeneratedArtifact({ logicalPath: 'z.ts', content: 'z\r\n' }),
      createGeneratedArtifact({
        logicalPath: 'docs/a.md',
        type: 'DOCUMENTATION',
        content: '# A\r',
      }),
    ]);
    const before = structuredClone(input);
    const service = new ResponseProcessorService(configuration, checksum);
    const first = await service.process(input);
    const second = await service.process(structuredClone(input));

    expect(first).toEqual(second);
    expect(input).toEqual(before);
    expect(first.schemaVersion).toBe(1);
    expect(first.executionResult).toEqual(input.executionResult);
    expect(first.executionResult).not.toBe(input.executionResult);
    expect(first.generatedArtifacts.map(({ logicalPath }) => logicalPath)).toEqual([
      'docs/a.md',
      'z.ts',
    ]);
    expect(first.generatedArtifacts.map(({ content }) => content)).toEqual(['# A\n', 'z\n']);
    expect(first.manifest.entries.map(({ logicalPath }) => logicalPath)).toEqual([
      'docs/a.md',
      'z.ts',
    ]);
    expect(first.diagnostics.map(({ code }) => code)).toEqual(['ALPHA', 'ZETA']);
    expect(first.warnings.map(({ code }) => code)).toEqual(['ALPHA_WARNING', 'ZETA_WARNING']);
    expect(Object.keys(first.metadata)).toEqual(['execution-policy', 'provider-id', 'shared']);
  });

  it('returns defensive copies across calls', async () => {
    const service = new ResponseProcessorService(configuration, checksum);
    const first = await service.process(createProcessingInput());
    const artifact = first.generatedArtifacts[0];
    if (artifact !== undefined) Reflect.set(artifact, 'content', 'changed');
    const second = await service.process(createProcessingInput());
    expect(second.generatedArtifacts[0]?.content).not.toBe('changed');
  });

  it('rejects invalid nested artifacts and never returns a partial package', async () => {
    const invalid = createProcessingInput([
      createGeneratedArtifact({ logicalPath: '../escape.ts' }),
    ]);
    await expect(
      new ResponseProcessorService(configuration, checksum).process(invalid),
    ).rejects.toBeInstanceOf(ResponseProcessorValidationError);
  });
});
