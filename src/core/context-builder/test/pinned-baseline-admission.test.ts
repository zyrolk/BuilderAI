import { describe, expect, it } from 'vitest';

import { ContextBuilderService } from '../services/context-builder.service';
import { createContextInput } from '../test/context-builder.fixture';
import type { ContextSourceFile } from '../types';

function createManyLowRankFiles(count: number): readonly ContextSourceFile[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `src/low-rank/file-${index}.ts`,
    content: `export const value${index} = ${index};\n`,
    priority: 'RELATED_SOURCE_FILES' as const,
  }));
}

describe('ContextBuilder pinned baseline admission', () => {
  const service = new ContextBuilderService();

  it('admits pinned baselines ahead of ranked files and deduplicates paths', async () => {
    const pinned: ContextSourceFile = {
      path: 'src/core/context-builder/context-builder.ts',
      content: 'export const pinned = true;\n',
      priority: 'PINNED_BASELINE',
    };
    const input = await createContextInput();
    const packageValue = await service.build({
      ...input,
      pinnedBaselineFiles: [pinned],
    });

    const matches = packageValue.relevantFiles.filter(
      ({ path }) => path === 'src/core/context-builder/context-builder.ts',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.priority).toBe('PINNED_BASELINE');
  });

  it('evicts lower-ranked related source files before pinned baselines under budget pressure', async () => {
    const input = await createContextInput(undefined, [
      ...createManyLowRankFiles(20).map(({ path, content }) => ({ path, content })),
      {
        path: 'src/core/context-builder/pinned-target.ts',
        content: `${'p'.repeat(80_000)}\n`,
      },
    ]);
    const packageValue = await service.build(
      {
        ...input,
        pinnedBaselineFiles: [
          {
            path: 'src/core/context-builder/pinned-target.ts',
            content: 'export const pinnedTarget = true;\n',
            priority: 'PINNED_BASELINE',
          },
        ],
      },
      { limitOverrides: { maxFiles: 4, maxCharacters: 95_000 } },
    );

    expect(
      packageValue.relevantFiles.some(
        ({ path, priority }) =>
          path === 'src/core/context-builder/pinned-target.ts' && priority === 'PINNED_BASELINE',
      ),
    ).toBe(true);
  });
});
