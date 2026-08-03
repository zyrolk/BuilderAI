import { describe, expect, it } from 'vitest';

import {
  buildDecompositionPromptPackage,
  parseDecompositionOutput,
} from '../../core/feature-decomposition';
import { scoreCandidatePath } from '../../core/context-builder/internal/path-relevance';
import { CONTEXT_RETRIEVAL_SCORING } from '../../core/context-builder/config/context-retrieval-policy';
import {
  DecompositionContextBuilder,
  measureDecompositionContext,
} from './decomposition-context.service';
import { DECOMPOSITION_CONTEXT_LIMITS } from './feature-plan.types';
import { normalizeFeaturePlan } from './feature-plan.service';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { BlueprintReaderService } from '../../core/blueprint-reader';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../infrastructure/project';

describe('Decomposition architecture ownership boundaries (ADR-026)', () => {
  it('includes bounded architecture boundary information in decomposition context', async () => {
    const context = await buildLiveContext(
      'Add activity history to the workspace workflow with local persistence.',
    );

    expect(context.ownershipBoundaries.length).toBeGreaterThan(0);
    expect(context.ownershipBoundaries.length).toBeLessThanOrEqual(6);
    for (const boundary of context.ownershipBoundaries) {
      expect(boundary.length).toBeLessThanOrEqual(240);
    }
    expect(context.ownershipBoundaries.join(' ')).toMatch(/Project Brain/i);
    expect(context.ownershipBoundaries.join(' ')).toMatch(/\.builderai/i);
    expect(context.ownershipBoundaries.join(' ')).toMatch(/src\/application\/workspace/i);
  });

  it('instructs ownership-aligned expectedAreas in the decomposition prompt', async () => {
    const context = await buildLiveContext('Add checkout summary to the workspace UI.');
    const prompt = buildDecompositionPromptPackage(context, 'boundary-prompt-001');
    const serialized = JSON.stringify(prompt);

    expect(serialized).toContain('ownershipBoundaries');
    expect(serialized).toContain('ownership-aligned-areas');
    expect(serialized).toMatch(
      /Do not default workflow-local or application features to Project Brain paths/i,
    );
    expect(serialized).toMatch(
      /Set expectedAreas to repository paths aligned with ownershipBoundaries/i,
    );
  });

  it('does not steer workflow-local decomposition toward Project Brain by default', async () => {
    const context = await buildLiveContext(
      'Add activity history listing to the workspace workflow with local persistence.',
    );
    const boundaries = context.ownershipBoundaries.join(' ');

    expect(boundaries).toMatch(/not canonical Project Brain/i);
    expect(boundaries).toMatch(/operational workflow features/i);
    expect(boundaries).not.toMatch(/Activity History/i);
  });

  it('still permits Project Brain governance tasks to target canonical Project Brain paths', async () => {
    const context = await buildLiveContext(
      'Update project-brain governance contracts to add a new decision category.',
    );
    const promptText = JSON.stringify(
      buildDecompositionPromptPackage(context, 'pb-governance-001'),
    );

    expect(promptText).toMatch(
      /only when the task explicitly changes Project Brain governance, contracts, or canonical state/i,
    );
    expect(context.ownershipBoundaries.join(' ')).toMatch(
      /genuinely changes Project Brain governance/i,
    );
  });

  it('can represent .builderai as local workflow persistence', async () => {
    const context = await buildLiveContext(
      'Persist approved feature plans locally for restart safety.',
    );
    const boundaries = context.ownershipBoundaries.join(' ');

    expect(boundaries).toMatch(/\.builderai/i);
    expect(boundaries).toMatch(/local workflow state/i);
  });

  it('keeps decomposition context within the 15,000-character budget', async () => {
    const context = await buildLiveContext(
      'Add a bounded checkout feature with cart persistence, order summary, admin review, and schema updates.',
    );

    expect(measureDecompositionContext(context)).toBeLessThanOrEqual(
      DECOMPOSITION_CONTEXT_LIMITS.MAX_SERIALIZED_CHARACTERS,
    );
  });

  it('preserves existing task count, path safety, and DAG validation', () => {
    const now = '2026-08-02T00:00:00.000Z';
    const plan = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: 'plan-boundary-001',
        sourceRequest: 'Add workspace feature',
        title: 'Workspace feature',
        summary: 'Summary',
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
        tasks: [
          {
            taskId: 'task-001',
            title: 'Types',
            objective: 'Add types',
            scope: 'Types only',
            dependencyIds: [],
            expectedAreas: ['src/application/workspace'],
            acceptanceCriteria: ['Types compile'],
            order: 1,
            status: 'PENDING',
          },
          {
            taskId: 'task-002',
            title: 'Service',
            objective: 'Add service',
            scope: 'Service only',
            dependencyIds: ['task-001'],
            expectedAreas: ['../secrets'],
            acceptanceCriteria: ['Service works'],
            order: 2,
            status: 'PENDING',
          },
        ],
      },
      { now },
    );

    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[1]?.expectedAreas).toEqual([]);

    expect(() =>
      normalizeFeaturePlan(
        {
          schemaVersion: 1,
          featurePlanId: 'plan-boundary-002',
          sourceRequest: 'Cyclic tasks',
          title: 'Cyclic',
          summary: 'Summary',
          status: 'DRAFT',
          createdAt: now,
          updatedAt: now,
          tasks: [
            {
              taskId: 'task-001',
              title: 'Task 1',
              objective: 'Objective',
              scope: 'Scope',
              dependencyIds: ['task-002'],
              expectedAreas: ['src/application/workspace'],
              acceptanceCriteria: ['Done'],
              order: 1,
              status: 'PENDING',
            },
            {
              taskId: 'task-002',
              title: 'Task 2',
              objective: 'Objective',
              scope: 'Scope',
              dependencyIds: ['task-001'],
              expectedAreas: ['src/application/workspace'],
              acceptanceCriteria: ['Done'],
              order: 2,
              status: 'PENDING',
            },
          ],
        },
        { now },
      ),
    ).toThrow(/cycle/i);
  });

  it('keeps Phase 2 iteration path hints as non-forcing retrieval boosts only', () => {
    const unrelatedPath = 'src/core/project-brain/types/project-brain.ts';
    const workspacePath = 'src/application/workspace/activity-history.service.ts';
    const taskText =
      'Add activity history listing to the workspace workflow with project brain context.';
    const queryVariants = new Set(['activity', 'history', 'workspace', 'project', 'brain']);
    const categories = new Set<'UI' | 'API' | 'AUTH_ADMIN' | 'DATABASE' | 'TESTS'>();
    const modulePaths = new Set(['src/application/workspace']);

    const withoutHints = scoreCandidatePath(
      unrelatedPath,
      queryVariants,
      categories,
      modulePaths,
      taskText,
    );
    expect(withoutHints).toBeGreaterThanOrEqual(1);
    const withMisleadingHint = scoreCandidatePath(
      unrelatedPath,
      queryVariants,
      categories,
      modulePaths,
      taskText,
      new Set([unrelatedPath]),
    );
    const workspaceScore = scoreCandidatePath(
      workspacePath,
      queryVariants,
      categories,
      modulePaths,
      taskText,
    );

    expect(withMisleadingHint - withoutHints).toBe(
      CONTEXT_RETRIEVAL_SCORING.ITERATION_PATH_HINT_BOOST,
    );
    expect(withMisleadingHint).toBeLessThan(workspaceScore);
  });

  it('does not silently rewrite invalid expectedAreas during provider output normalization', () => {
    const parsed = parseDecompositionOutput({
      title: 'Feature',
      summary: 'Summary',
      tasks: [
        {
          taskId: 'task-001',
          title: 'Bad path',
          objective: 'Objective',
          scope: 'Scope',
          dependencyIds: [],
          expectedAreas: ['src/core/project-brain/types', '../../secrets'],
          acceptanceCriteria: ['Done'],
          order: 1,
        },
      ],
    });

    const now = '2026-08-02T00:00:00.000Z';
    const plan = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: 'plan-boundary-003',
        sourceRequest: 'Add feature',
        title: parsed.title ?? 'Feature',
        summary: parsed.summary ?? 'Summary',
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
        tasks: parsed.tasks ?? [],
      },
      { now },
    );

    expect(plan.tasks[0]?.expectedAreas).toEqual(['src/core/project-brain/types']);
  });
});

async function buildLiveContext(featureRequest: string) {
  const projectRoot = process.cwd();
  const brain = loadCanonicalProjectBrain();
  const reader = new BlueprintReaderService(new NodeFileSystemDocumentSource(projectRoot));
  const readerOutput = await reader.read();
  const builder = new DecompositionContextBuilder();
  return builder.build(
    featureRequest,
    brain,
    readerOutput,
    new NodeProjectFileSource(projectRoot),
    async () => undefined,
  );
}
