import { describe, expect, it } from 'vitest';

import { UpdateScopePlanner } from '../services/update-scope-planner.service';

const SMOKE_PATHS = ['index.html', 'assets/app.js', 'assets/styles.css', 'project-brain.json'];

describe('UpdateScopePlanner', () => {
  const planner = new UpdateScopePlanner();

  it('returns HARD mode for explicit index.html only instructions', () => {
    const plan = planner.plan({
      taskText: 'Modify index.html only to improve accessibility.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('HARD');
    expect(plan.requiredBaselinePaths).toEqual(['index.html']);
    expect(plan.preferredUpdatePaths).toEqual(['index.html']);
    expect(plan.preferredMaximumUpdateOperations).toBe(1);
    expect(plan.evidence.some(({ code }) => code === 'EXPLICIT_ONLY_PATH_INSTRUCTION')).toBe(true);
  });

  it('returns SOFT mode for accessibility requests without explicit path', () => {
    const plan = planner.plan({
      taskText: 'Make the counter button more accessible with aria attributes.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('SOFT');
    expect(plan.preferredUpdatePaths).toContain('index.html');
    expect(plan.evidence.some(({ code }) => code === 'HTML_ENTRYPOINT_HEURISTIC')).toBe(true);
  });

  it('prefers JS paths for JS-only behavior requests', () => {
    const plan = planner.plan({
      taskText: 'Fix the JavaScript counter behavior and localStorage persistence.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('SOFT');
    expect(plan.preferredUpdatePaths).toContain('assets/app.js');
  });

  it('prefers CSS paths for CSS-only requests', () => {
    const plan = planner.plan({
      taskText: 'Update the stylesheet colors for the counter button.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('SOFT');
    expect(plan.preferredUpdatePaths).toContain('assets/styles.css');
  });

  it('includes HTML and JS for legitimate multi-file requests', () => {
    const plan = planner.plan({
      taskText: 'Update index.html and assets/app.js so the counter id contract stays aligned.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('SOFT');
    expect(plan.preferredUpdatePaths).toEqual(['assets/app.js', 'index.html']);
  });

  it('returns NONE for CREATE-only tasks', () => {
    const plan = planner.plan({
      taskText: 'Create a new landing page from scratch with a hero section.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('NONE');
    expect(plan.requiredBaselinePaths).toEqual([]);
  });

  it('returns NONE when no reliable scope can be inferred', () => {
    const plan = planner.plan({
      taskText: 'Improve the project.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('NONE');
  });

  it('does not treat protected paths as update targets', () => {
    const plan = planner.plan({
      taskText: 'Modify project-brain.json only.',
      sourcePaths: SMOKE_PATHS,
    });

    expect(plan.mode).toBe('NONE');
    expect(plan.preferredUpdatePaths).not.toContain('project-brain.json');
  });

  it('caps required baselines at three paths', () => {
    const plan = planner.plan({
      taskText: 'Update index.html, assets/app.js, assets/styles.css, and docs/readme.md together.',
      sourcePaths: [...SMOKE_PATHS, 'docs/readme.md'],
    });

    expect(plan.requiredBaselinePaths.length).toBeLessThanOrEqual(3);
  });

  it('orders evidence deterministically', () => {
    const plan = planner.plan({
      taskText: 'Modify index.html only and improve accessibility.',
      sourcePaths: SMOKE_PATHS,
    });
    const serialized = plan.evidence.map(({ code, path }) => `${code}:${path ?? ''}`);
    expect(serialized).toEqual([...serialized].sort());
  });
});
