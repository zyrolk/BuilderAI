import { describe, expect, it } from 'vitest';

import { PinnedBaselineResolver } from '../services/pinned-baseline-resolver.service';
import { UpdateScopePlanner } from '../services/update-scope-planner.service';
import { MemoryWorkspaceBaselinePort } from './workspace-baseline.fixture';

describe('PinnedBaselineResolver', () => {
  const resolver = new PinnedBaselineResolver();
  const planner = new UpdateScopePlanner();

  it('returns inactive scope when all baselines are unavailable', () => {
    const scopePlan = planner.plan({
      taskText: 'Modify index.html only.',
      sourcePaths: ['index.html'],
    });
    const resolution = resolver.resolve(scopePlan, new MemoryWorkspaceBaselinePort({}));

    expect(resolution.scopePlan.mode).toBe('NONE');
    expect(resolution.pinnedFiles).toEqual([]);
    expect(resolution.omissions.some(({ reason }) => reason === 'BASELINE_UNAVAILABLE')).toBe(true);
  });

  it('admits pinned baselines and builds preservation contract', () => {
    const html = '<button id="counter-button" aria-label="Counter">0</button>';
    const scopePlan = planner.plan({
      taskText: 'Modify index.html only.',
      sourcePaths: ['index.html'],
    });
    const resolution = resolver.resolve(
      scopePlan,
      new MemoryWorkspaceBaselinePort({ 'index.html': html }),
    );

    expect(resolution.pinnedFiles).toEqual([
      expect.objectContaining({ path: 'index.html', priority: 'PINNED_BASELINE', content: html }),
    ]);
    expect(resolution.preservationContract?.baselines[0]?.logicalPath).toBe('index.html');
    expect(resolution.preservationContract?.invariants.length).toBeGreaterThan(0);
  });

  it('marks remaining paths unavailable when pinned baseline budget is exceeded', () => {
    const large = 'x'.repeat(40_000);
    const scopePlan = {
      ...planner.plan({
        taskText: 'Update index.html and assets/app.js together.',
        sourcePaths: ['index.html', 'assets/app.js'],
      }),
      requiredBaselinePaths: ['index.html', 'assets/app.js'],
      preferredUpdatePaths: ['index.html', 'assets/app.js'],
    };
    const resolution = resolver.resolve(
      scopePlan,
      new MemoryWorkspaceBaselinePort({
        'index.html': large,
        'assets/app.js': large,
      }),
    );

    expect(resolution.pinnedFiles.length).toBe(1);
    expect(resolution.omissions.some(({ reason }) => reason === 'BASELINE_BUDGET_EXCEEDED')).toBe(
      true,
    );
  });
});
