import type { ProjectFileSource } from '../ports';
import { DependencyResolutionService } from './dependency-resolution.service';

function sourceWithExternalReference(externalContent?: string): ProjectFileSource {
  const files = new Map<string, string>([
    [
      'src/core/project-brain/feature-reader.ts',
      "import brain from '../../../project-brain.json';\nexport default brain;\n",
    ],
    ...(externalContent === undefined ? [] : ([['project-brain.json', externalContent]] as const)),
  ]);
  return {
    listSourcePaths: async () => ['src/core/project-brain/feature-reader.ts'],
    readSourceFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`Missing '${path}'.`);
      return content;
    },
  };
}

describe('DependencyResolutionService', () => {
  const service = new DependencyResolutionService();

  it('validates readable relative imports outside the discovery index without packaging them', async () => {
    const resolution = await service.resolveFiles(
      ['src/core/project-brain/feature-reader.ts'],
      sourceWithExternalReference('{"schemaVersion":1}'),
      'Define the feature reader for project brain context.',
      [],
      [],
      4,
    );

    expect(resolution.files.map(({ path }) => path)).toEqual([
      'src/core/project-brain/feature-reader.ts',
    ]);
    expect(resolution.reads).toBe(2);
  });

  it('continues to reject missing relative imports outside the discovery index', async () => {
    await expect(
      service.resolveFiles(
        ['src/core/project-brain/feature-reader.ts'],
        sourceWithExternalReference(),
        'Define the feature reader for project brain context.',
        [],
        [],
        4,
      ),
    ).rejects.toMatchObject({
      code: 'CONTEXT_BUILDER_VALIDATION_FAILED',
      issues: [
        expect.objectContaining({
          code: 'INVALID_REFERENCE',
          message:
            "Source file 'src/core/project-brain/feature-reader.ts' references unavailable relative import 'project-brain.json'",
        }),
      ],
    });
  });
});
