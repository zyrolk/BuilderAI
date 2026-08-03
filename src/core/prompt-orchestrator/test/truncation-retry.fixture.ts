import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import { PromptOrchestratorService } from '../services';
import type { PromptPackage } from '../types';

export async function createCorrectionPromptPackage(
  paths: {
    updated?: readonly string[];
    created?: readonly string[];
    deleted?: readonly string[];
  } = {},
): Promise<PromptPackage> {
  const context = await new ContextBuilderService().build(await createContextInput());
  return new PromptOrchestratorService().build({
    context,
    iterationFeedback: {
      schemaVersion: 1,
      kind: 'CORRECTION',
      apply: {
        status: 'APPLIED',
        createdPaths: paths.created ?? [],
        updatedPaths: paths.updated ?? [],
        deletedPaths: paths.deleted ?? [],
        skippedPaths: [],
        errors: [],
        warnings: [],
      },
    },
  });
}
