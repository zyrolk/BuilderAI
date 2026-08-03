import { describe, expect, it } from 'vitest';

import { parseProjectBrain, loadCanonicalProjectBrain } from '../../core/project-brain';
import {
  createBoundedProjectTaskId,
  FEATURE_SHADOW_TASK_ID_PREFIX,
  FEATURE_TASK_ID_PREFIX,
  PROJECT_BRAIN_IDENTIFIER_MAX_LENGTH,
  PROJECT_BRAIN_IDENTIFIER_PATTERN,
} from './bounded-project-task-id';
import {
  createFeatureTransientTask,
  createShadowDependencyTasks,
  normalizeFeaturePlan,
} from './feature-plan.service';

const NOW = '2026-08-02T12:00:00.000Z';
const PILOT_DESCRIPTIVE_TASK_ID = 'task-1-history-types-and-schema';
const MAX_PLAN_ID = `${'a'.repeat(126)}-1`;
const MAX_TASK_ID = `task-${'x'.repeat(59)}`;
const MAX_PREP_ID = '12345678-1234-1234-1234-123456789012';

function assertValidProjectBrainTaskId(id: string): void {
  expect(id.length).toBeLessThanOrEqual(PROJECT_BRAIN_IDENTIFIER_MAX_LENGTH);
  expect(id).toMatch(PROJECT_BRAIN_IDENTIFIER_PATTERN);
}

describe('createBoundedProjectTaskId', () => {
  it('accepts short FeatureTask IDs', () => {
    const id = createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, ['plan-1', 'task-01', 'prep-1']);
    assertValidProjectBrainTaskId(id);
    expect(id.startsWith(`${FEATURE_TASK_ID_PREFIX}-`)).toBe(true);
  });

  it('accepts maximum valid FeatureTask IDs', () => {
    const id = createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, [
      MAX_PLAN_ID,
      MAX_TASK_ID,
      MAX_PREP_ID,
    ]);
    assertValidProjectBrainTaskId(id);
  });

  it('accepts the descriptive fresh-pilot FeatureTask ID', () => {
    const id = createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, [
      '16a0c3ac-232b-41a2-98fe-4ad6fafd27f5',
      PILOT_DESCRIPTIVE_TASK_ID,
      MAX_PREP_ID,
    ]);
    assertValidProjectBrainTaskId(id);
    expect(id.length).toBeLessThan(30);
  });

  it('is deterministic for identical semantic inputs', () => {
    const parts = ['plan-a', PILOT_DESCRIPTIVE_TASK_ID, 'prep-b'] as const;
    expect(createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, parts)).toBe(
      createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, parts),
    );
  });

  it('does not trivially collide for different semantic identities', () => {
    const left = createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, ['plan-a', 'task-a', 'prep-a']);
    const right = createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, [
      'plan-b',
      'task-b',
      'prep-b',
    ]);
    expect(left).not.toBe(right);
  });
});

describe('synthetic ProjectTask identifiers in feature workflow', () => {
  function approvedPlan(
    overrides: {
      readonly featurePlanId?: string;
      readonly taskId?: string;
      readonly dependencyTaskId?: string;
    } = {},
  ) {
    return normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: overrides.featurePlanId ?? 'plan-boundary-001',
        sourceRequest: 'Add activity history',
        title: 'Activity history',
        summary: 'Summary',
        status: 'APPROVED',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: overrides.dependencyTaskId ?? 'task-001',
            title: 'Types',
            objective: 'Add types',
            scope: 'Types',
            order: 1,
            status: 'COMPLETED',
            lastOutcome: { summary: 'Done', completedAt: NOW },
          },
          {
            taskId: overrides.taskId ?? PILOT_DESCRIPTIVE_TASK_ID,
            title: 'Recorder',
            objective: 'Add recorder',
            scope: 'Service',
            dependencyIds: [overrides.dependencyTaskId ?? 'task-001'],
            order: 2,
            status: 'READY',
          },
        ],
      },
      { now: NOW },
    );
  }

  it('bounds shadow dependency task IDs under worst-case plan/task lengths', () => {
    const plan = approvedPlan({ featurePlanId: MAX_PLAN_ID, dependencyTaskId: MAX_TASK_ID });
    const downstream = plan.tasks.find(({ taskId }) => taskId === PILOT_DESCRIPTIVE_TASK_ID)!;
    const shadows = createShadowDependencyTasks(plan, downstream, NOW);
    expect(shadows).toHaveLength(1);
    assertValidProjectBrainTaskId(shadows[0]!.id);
    expect(shadows[0]!.id.startsWith(`${FEATURE_SHADOW_TASK_ID_PREFIX}-`)).toBe(true);
  });

  it('accepts worst-case synthetic tasks inside parseProjectBrain', () => {
    const plan = approvedPlan({ featurePlanId: MAX_PLAN_ID, taskId: MAX_TASK_ID });
    const task = plan.tasks.find(({ taskId }) => taskId === MAX_TASK_ID)!;
    const shadows = createShadowDependencyTasks(plan, task, NOW);
    const transient = createFeatureTransientTask(
      plan,
      task,
      task.objective,
      MAX_PREP_ID,
      NOW,
      shadows,
    );
    for (const synthetic of [transient, ...shadows]) {
      assertValidProjectBrainTaskId(synthetic.id);
    }
    const brain = loadCanonicalProjectBrain();
    expect(() =>
      parseProjectBrain({ ...brain, tasks: [...brain.tasks, ...shadows, transient] }),
    ).not.toThrow();
  });

  it('preserves distinct shadow and transient IDs for the same dependency set', () => {
    const plan = approvedPlan();
    const task = plan.tasks.find(({ taskId }) => taskId === PILOT_DESCRIPTIVE_TASK_ID)!;
    const shadows = createShadowDependencyTasks(plan, task, NOW);
    const transient = createFeatureTransientTask(
      plan,
      task,
      task.objective,
      'prep-descriptive-001',
      NOW,
      shadows,
    );
    expect(transient.id).not.toBe(shadows[0]!.id);
    expect(transient.dependencyIds).toEqual([shadows[0]!.id]);
  });
});

describe('ordinary workspace transient task IDs', () => {
  it('keeps the existing workspace-request prefix for backward compatibility', () => {
    const correlationId = '12345678-1234-1234-1234-123456789012';
    const id = `workspace-request-${correlationId}`;
    assertValidProjectBrainTaskId(id);
    expect(id.startsWith('workspace-request-')).toBe(true);
  });
});
