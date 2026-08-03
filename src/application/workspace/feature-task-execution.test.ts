import { describe, expect, it, vi } from 'vitest';

import {
  buildFeatureTaskRequest,
  createShadowDependencyTasks,
  markTaskOutcome,
  normalizeFeaturePlan,
} from './feature-plan.service';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

const NOW = '2026-08-01T00:00:00.000Z';

describe('feature task execution helpers', () => {
  it('builds bounded task requests from task fields', () => {
    const task = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: 'plan-task-req-01',
        sourceRequest: 'Feature',
        title: 'Feature',
        summary: 'Summary',
        status: 'APPROVED',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-01',
            title: 'API',
            objective: 'Add API routes',
            scope: 'src/app/api',
            acceptanceCriteria: ['Routes validate input'],
            order: 1,
            status: 'READY',
          },
        ],
      },
      { now: NOW },
    ).tasks[0]!;
    const request = buildFeatureTaskRequest(task);
    expect(request).toContain('Add API routes');
    expect(request).toContain('Acceptance criteria');
  });

  it('creates bounded shadow dependency tasks for completed prerequisites', () => {
    const plan = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: 'plan-shadow-01',
        sourceRequest: 'Feature',
        title: 'Feature',
        summary: 'Summary',
        status: 'APPROVED',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-01',
            title: 'Schema',
            objective: 'Add schema',
            scope: 'prisma',
            order: 1,
            status: 'COMPLETED',
            lastOutcome: { summary: 'Done', completedAt: NOW },
          },
          {
            taskId: 'task-02',
            title: 'API',
            objective: 'Add API',
            scope: 'src/app/api',
            dependencyIds: ['task-01'],
            order: 2,
            status: 'READY',
          },
        ],
      },
      { now: NOW },
    );
    const downstream = plan.tasks.find(({ taskId }) => taskId === 'task-02')!;
    const shadows = createShadowDependencyTasks(plan, downstream, NOW);
    expect(shadows).toHaveLength(1);
    expect(shadows[0]?.status).toBe('DONE');
  });

  it('does not auto-complete tasks on partial verification', async () => {
    const plan = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: 'plan-partial-01',
        sourceRequest: 'Feature',
        title: 'Feature',
        summary: 'Summary',
        status: 'IN_PROGRESS',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-01',
            title: 'API',
            objective: 'Add API',
            scope: 'src/app/api',
            order: 1,
            status: 'IN_PROGRESS',
          },
        ],
      },
      { now: NOW },
    );
    expect(() =>
      markTaskOutcome(
        plan,
        'task-01',
        'COMPLETED',
        { summary: 'Partial', completedAt: NOW, verificationStatus: 'PARTIALLY_PASSED' },
        NOW,
      ),
    ).not.toThrow();
  });

  it('completes the plan when all tasks are terminal', () => {
    let plan = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: 'plan-complete-01',
        sourceRequest: 'Feature',
        title: 'Feature',
        summary: 'Summary',
        status: 'IN_PROGRESS',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-01',
            title: 'A',
            objective: 'A',
            scope: '',
            order: 1,
            status: 'IN_PROGRESS',
          },
        ],
      },
      { now: NOW },
    );
    plan = markTaskOutcome(
      plan,
      'task-01',
      'COMPLETED',
      { summary: 'Done', completedAt: NOW, verificationStatus: 'PASSED' },
      NOW,
    );
    expect(plan.status).toBe('COMPLETED');
  });
});

describe('FeatureWorkflowService completion guards', () => {
  it('requires verification PASSED unless explicitly acknowledged', async () => {
    const { FeatureWorkflowService } = await import('./feature-workflow.service');
    const service = new FeatureWorkflowService({
      runtime: { prepareFeatureTask: vi.fn() } as never,
      persistence: { save: vi.fn(), load: vi.fn(), loadActive: vi.fn() } as never,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(
      normalizeFeaturePlan(
        {
          schemaVersion: 1,
          featurePlanId: 'plan-guard-01',
          sourceRequest: 'Feature',
          title: 'Feature',
          summary: 'Summary',
          status: 'IN_PROGRESS',
          createdAt: NOW,
          updatedAt: NOW,
          tasks: [
            {
              taskId: 'task-01',
              title: 'A',
              objective: 'A',
              scope: '',
              order: 1,
              status: 'IN_PROGRESS',
            },
          ],
        },
        { now: NOW },
      ),
    );
    await expect(
      service.completeTask('plan-guard-01', 'task-01', {
        summary: 'Failed apply',
        completedAt: NOW,
        verificationStatus: 'FAILED',
      }),
    ).rejects.toThrow(WorkspaceRuntimeError);
  });
});
