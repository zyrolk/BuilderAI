import { describe, expect, it } from 'vitest';

import {
  applyReadiness,
  dependenciesSatisfied,
  normalizeFeaturePlan,
  validateTaskExecutable,
} from './feature-plan.service';
import { FEATURE_PLAN_LIMITS } from './feature-plan.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

const NOW = '2026-08-01T00:00:00.000Z';

function createPlan(
  tasks: readonly Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) {
  return normalizeFeaturePlan(
    {
      schemaVersion: 1,
      featurePlanId: 'plan-test-001',
      sourceRequest: 'Build checkout flow',
      title: 'Checkout feature',
      summary: 'Add checkout',
      status: 'DRAFT',
      createdAt: NOW,
      updatedAt: NOW,
      tasks,
      ...overrides,
    },
    { now: NOW },
  );
}

describe('feature plan validation', () => {
  it('accepts a valid draft plan', () => {
    const plan = createPlan([
      {
        taskId: 'task-01',
        title: 'Schema',
        objective: 'Add schema',
        scope: 'prisma',
        dependencyIds: [],
        expectedAreas: ['prisma'],
        acceptanceCriteria: ['Schema validates'],
        order: 1,
        status: 'PENDING',
      },
    ]);
    expect(plan.tasks).toHaveLength(1);
    expect(plan.status).toBe('DRAFT');
  });

  it('rejects duplicate task ids', () => {
    expect(() =>
      createPlan([
        { taskId: 'task-01', title: 'A', objective: 'A', scope: '', order: 1 },
        { taskId: 'task-01', title: 'B', objective: 'B', scope: '', order: 2 },
      ]),
    ).toThrow(WorkspaceRuntimeError);
  });

  it('rejects missing dependency references', () => {
    expect(() =>
      createPlan([
        {
          taskId: 'task-01',
          title: 'A',
          objective: 'A',
          scope: '',
          dependencyIds: ['missing'],
          order: 1,
        },
      ]),
    ).toThrow(/missing dependency/i);
  });

  it('rejects dependency cycles', () => {
    expect(() =>
      createPlan([
        {
          taskId: 'task-01',
          title: 'A',
          objective: 'A',
          scope: '',
          dependencyIds: ['task-02'],
          order: 1,
        },
        {
          taskId: 'task-02',
          title: 'B',
          objective: 'B',
          scope: '',
          dependencyIds: ['task-01'],
          order: 2,
        },
      ]),
    ).toThrow(/cycle/i);
  });

  it('rejects unsafe expectedAreas', () => {
    expect(() =>
      createPlan([
        {
          taskId: 'task-01',
          title: 'A',
          objective: 'A',
          scope: '',
          expectedAreas: ['../secrets'],
          order: 1,
        },
      ]),
    ).not.toThrow();
    const plan = createPlan([
      {
        taskId: 'task-01',
        title: 'A',
        objective: 'A',
        scope: '',
        expectedAreas: ['../secrets', '/etc/passwd'],
        order: 1,
      },
    ]);
    expect(plan.tasks[0]?.expectedAreas).toEqual([]);
  });

  it('rejects plans above serialized limit after normalization', () => {
    const hugeCriteria = 'x'.repeat(FEATURE_PLAN_LIMITS.MAX_ACCEPTANCE_CRITERION);
    const tasks = Array.from({ length: FEATURE_PLAN_LIMITS.MAX_TASKS }, (_, index) => ({
      taskId: `task-${String(index + 1).padStart(2, '0')}`,
      title: 'Task title that is still bounded',
      objective: 'o'.repeat(FEATURE_PLAN_LIMITS.MAX_OBJECTIVE),
      scope: 's'.repeat(FEATURE_PLAN_LIMITS.MAX_SCOPE),
      dependencyIds: [],
      expectedAreas: ['src', 'app', 'tests', 'docs', 'prisma', 'public', 'lib', 'core'],
      acceptanceCriteria: Array.from(
        { length: FEATURE_PLAN_LIMITS.MAX_ACCEPTANCE_CRITERIA },
        () => hugeCriteria,
      ),
      order: index + 1,
      status: 'PENDING',
    }));
    expect(() =>
      normalizeFeaturePlan({
        schemaVersion: 1,
        featurePlanId: 'plan-huge-001',
        sourceRequest: 'Build a very large e-commerce platform with many bounded tasks',
        title: 'Huge feature',
        summary: 's'.repeat(FEATURE_PLAN_LIMITS.MAX_SUMMARY),
        status: 'DRAFT',
        createdAt: NOW,
        updatedAt: NOW,
        tasks,
      }),
    ).toThrow(/16,000 character limit/i);
  });

  it('limits tasks to twelve entries', () => {
    const tasks = Array.from({ length: 20 }, (_, index) => ({
      taskId: `task-${String(index + 1).padStart(2, '0')}`,
      title: `Task ${index + 1}`,
      objective: `Objective ${index + 1}`,
      scope: '',
      order: index + 1,
    }));
    const plan = createPlan(tasks);
    expect(plan.tasks.length).toBeLessThanOrEqual(FEATURE_PLAN_LIMITS.MAX_TASKS);
  });
});

describe('dependency readiness', () => {
  it('marks root tasks READY after approval', () => {
    const draft = createPlan([
      { taskId: 'task-01', title: 'A', objective: 'A', scope: '', order: 1 },
      {
        taskId: 'task-02',
        title: 'B',
        objective: 'B',
        scope: '',
        dependencyIds: ['task-01'],
        order: 2,
      },
    ]);
    const approved = applyReadiness({ ...draft, status: 'APPROVED' });
    expect(approved.tasks[0]?.status).toBe('READY');
    expect(approved.tasks[1]?.status).toBe('PENDING');
  });

  it('does not treat skipped dependencies as satisfied without override', () => {
    const plan = applyReadiness(
      normalizeFeaturePlan({
        schemaVersion: 1,
        featurePlanId: 'plan-skip-001',
        sourceRequest: 'Feature',
        title: 'Feature',
        summary: 'Summary',
        status: 'APPROVED',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-01',
            title: 'A',
            objective: 'A',
            scope: '',
            order: 1,
            status: 'SKIPPED',
          },
          {
            taskId: 'task-02',
            title: 'B',
            objective: 'B',
            scope: '',
            dependencyIds: ['task-01'],
            order: 2,
          },
        ],
      }),
    );
    const downstream = plan.tasks.find(({ taskId }) => taskId === 'task-02');
    expect(downstream?.status).toBe('PENDING');
    expect(
      dependenciesSatisfied(
        downstream!,
        new Map(plan.tasks.map((task) => [task.taskId, task])),
        new Set(),
      ),
    ).toBe(false);
  });

  it('allows skipped dependency with explicit override', () => {
    const plan = applyReadiness(
      normalizeFeaturePlan({
        schemaVersion: 1,
        featurePlanId: 'plan-skip-002',
        sourceRequest: 'Feature',
        title: 'Feature',
        summary: 'Summary',
        status: 'APPROVED',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-01',
            title: 'A',
            objective: 'A',
            scope: '',
            order: 1,
            status: 'SKIPPED',
          },
          {
            taskId: 'task-02',
            title: 'B',
            objective: 'B',
            scope: '',
            dependencyIds: ['task-01'],
            order: 2,
          },
        ],
      }),
    );
    const downstream = plan.tasks.find(({ taskId }) => taskId === 'task-02')!;
    expect(
      dependenciesSatisfied(
        downstream,
        new Map(plan.tasks.map((task) => [task.taskId, task])),
        new Set(['task-01']),
      ),
    ).toBe(true);
  });

  it('blocks execution for dependency-blocked tasks', () => {
    const plan = applyReadiness({
      ...createPlan([
        { taskId: 'task-01', title: 'A', objective: 'A', scope: '', order: 1 },
        {
          taskId: 'task-02',
          title: 'B',
          objective: 'B',
          scope: '',
          dependencyIds: ['task-01'],
          order: 2,
        },
      ]),
      status: 'APPROVED',
    });
    expect(() => validateTaskExecutable(plan, 'task-02')).toThrow(/not ready for execution/i);
  });

  it('unlocks downstream tasks after completion', () => {
    let plan = applyReadiness({
      ...createPlan([
        { taskId: 'task-01', title: 'A', objective: 'A', scope: '', order: 1 },
        {
          taskId: 'task-02',
          title: 'B',
          objective: 'B',
          scope: '',
          dependencyIds: ['task-01'],
          order: 2,
        },
      ]),
      status: 'APPROVED',
    });
    plan = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.taskId === 'task-01' ? { ...task, status: 'COMPLETED' } : task,
      ),
    };
    plan = applyReadiness(plan);
    expect(plan.tasks.find(({ taskId }) => taskId === 'task-02')?.status).toBe('READY');
  });
});

describe('deterministic validation', () => {
  it('produces identical readiness for identical input', () => {
    const input = createPlan([
      { taskId: 'task-01', title: 'A', objective: 'A', scope: '', order: 1 },
      {
        taskId: 'task-02',
        title: 'B',
        objective: 'B',
        scope: '',
        dependencyIds: ['task-01'],
        order: 2,
      },
    ]);
    const left = applyReadiness({ ...input, status: 'APPROVED' });
    const right = applyReadiness({ ...input, status: 'APPROVED' });
    expect(left).toEqual(right);
  });
});
