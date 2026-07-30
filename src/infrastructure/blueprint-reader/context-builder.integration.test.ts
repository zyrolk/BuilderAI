import { BlueprintReaderService } from '@/core/blueprint-reader';
import { ContextBuilderService, type ProjectFileSource } from '@/core/context-builder';
import { loadCanonicalProjectBrain } from '@/core/project-brain';

import { NodeFileSystemDocumentSource } from './node-file-system-document-source';

const emptySource: ProjectFileSource = {
  listSourcePaths: async () => [],
  readSourceFile: async () => {
    throw new Error('No source path should be selected.');
  },
};

describe('current BuilderAI Context Package', () => {
  it('builds from the canonical Project Brain and production Blueprint Reader', async () => {
    const brain = loadCanonicalProjectBrain();
    const reader = await new BlueprintReaderService(
      new NodeFileSystemDocumentSource(process.cwd()),
    ).read();

    const packageValue = await new ContextBuilderService().build({
      projectBrain: brain,
      blueprintReaderOutput: reader,
      currentTaskId: 'verify-context-builder',
      sourceFileSource: emptySource,
    });

    expect(packageValue.projectIdentity.id).toBe(brain.blueprint.projectId);
    expect(packageValue.currentMilestone).toBe(brain.progressLog.currentMilestone);
    expect(packageValue.currentTask.id).toBe('verify-context-builder');
    expect(packageValue.size.characters).toBeLessThanOrEqual(packageValue.size.maxCharacters);
  });
});
