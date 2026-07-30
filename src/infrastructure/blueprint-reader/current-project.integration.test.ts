import { BlueprintReaderService } from '@/core/blueprint-reader';

import { NodeFileSystemDocumentSource } from './node-file-system-document-source';

describe('current BuilderAI Project Brain', () => {
  it('is readable end to end through the production filesystem adapter', async () => {
    const result = await new BlueprintReaderService(
      new NodeFileSystemDocumentSource(process.cwd()),
    ).read();

    expect(result.valid).toBe(true);
    expect(result.summary?.projectOverview.name).toBe('BuilderAI');
    expect(result.summary?.missingDocumentation).toEqual([]);
    expect(result.diagnostics.every(({ severity }) => severity !== 'ERROR')).toBe(true);
  });
});
