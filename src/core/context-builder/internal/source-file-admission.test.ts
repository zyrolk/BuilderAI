import type { ContextSourceFile } from '../types';
import { admitSourceFilesByMeasuredBudget } from './source-file-admission';

function sourceFile(path: string, content: string): ContextSourceFile {
  return { path, content, priority: 'RELATED_SOURCE_FILES' };
}

describe('source file admission', () => {
  it('admits highest-ranked files until the measured budget is exhausted', () => {
    const ranked = [
      sourceFile('src/a.ts', 'a'.repeat(100)),
      sourceFile('src/b.ts', 'b'.repeat(100)),
      sourceFile('src/c.ts', 'c'.repeat(5_000)),
    ];
    const measure = (files: readonly ContextSourceFile[]) =>
      JSON.stringify({ files: files.map(({ path, content }) => ({ path, content })) }).length;
    const firstCost = measure([ranked[0]!]);
    const secondCost = measure([ranked[0]!, ranked[1]!]);
    const budget = secondCost + 10;

    const { admitted, omissions } = admitSourceFilesByMeasuredBudget(ranked, 12, budget, (files) =>
      measure(files),
    );

    expect(admitted.map(({ path }) => path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(omissions.filter(({ reason }) => reason === 'SIZE_LIMIT')).toEqual([
      { kind: 'FILE', identifier: 'src/c.ts', reason: 'SIZE_LIMIT' },
    ]);
    expect(firstCost).toBeLessThan(budget);
  });

  it('always admits at least one candidate even when it exceeds the budget', () => {
    const ranked = [sourceFile('src/large.ts', 'x'.repeat(10_000))];
    const measure = (files: readonly ContextSourceFile[]) =>
      JSON.stringify({ files: files.map(({ content }) => content) }).length;
    const { admitted, omissions } = admitSourceFilesByMeasuredBudget(ranked, 12, 100, (files) =>
      measure(files),
    );
    expect(admitted).toHaveLength(1);
    expect(omissions).toEqual([]);
  });
});
