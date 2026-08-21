import { describe, expect, it } from 'vitest';

import {
  DecompositionContextBuilder,
  measureDecompositionContext,
} from './decomposition-context.service';
import { DECOMPOSITION_CONTEXT_LIMITS } from './feature-plan.types';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { BlueprintReaderService } from '../../core/blueprint-reader';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../infrastructure/project';

describe('DecompositionContextBuilder', () => {
  it('stays under the hard decomposition context budget', async () => {
    const projectRoot = process.cwd();
    const brain = loadCanonicalProjectBrain();
    const reader = new BlueprintReaderService(new NodeFileSystemDocumentSource(projectRoot));
    const readerOutput = await reader.read();
    const builder = new DecompositionContextBuilder();
    const context = await builder.build(
      'Add a bounded checkout feature with cart persistence and order summary.',
      brain,
      readerOutput,
      new NodeProjectFileSource(projectRoot),
      async () => undefined,
    );
    expect(measureDecompositionContext(context)).toBeLessThanOrEqual(
      DECOMPOSITION_CONTEXT_LIMITS.MAX_SERIALIZED_CHARACTERS,
    );
  }, 30_000);
});
