import { describe, expect, it, vi } from 'vitest';

import { ProviderOutputTruncatedError } from '../../core/ai-provider';
import { FeatureWorkflowService } from './feature-workflow.service';
import { normalizeFeaturePlan } from './feature-plan.service';
import { buildIterationFeedbackFromCompletion } from './iteration-feedback.service';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import type { WorkspaceRuntimeService } from './workspace-runtime.service';
import type { FeaturePlanPersistence } from './feature-plan.persistence';
import type { FileApplyResult } from '../../core/file-apply';
import type { VerificationReport } from '../../core/verification';

const NOW = '2026-08-01T00:00:00.000Z';

const APPLIED_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'APPLIED',
  createdFiles: [],
  updatedFiles: ['src/example.ts'],
  deletedFiles: [],
  skippedFiles: [],
  warnings: [],
  errors: [],
  durationMs: 1,
  metadata: {},
};

const FAILED_VERIFICATION: VerificationReport = {
  schemaVersion: 1,
  status: 'FAILED',
  stages: [],
  warnings: [],
  errors: [{ code: 'TEST_FAILED', message: 'Verification failed.', stage: 'BUILD_VALIDATION' }],
  durationMs: 1,
  metadata: {},
};

function approvedPlan(): ReturnType<typeof normalizeFeaturePlan> {
  return normalizeFeaturePlan(
    {
      schemaVersion: 1,
      featurePlanId: 'workflow-plan-01',
      sourceRequest: 'Checkout',
      title: 'Checkout',
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
          dependencyIds: [],
          order: 1,
          status: 'READY',
        },
      ],
    },
    { now: NOW },
  );
}

describe('FeatureWorkflowService', () => {
  it('approves draft plans without filesystem mutations', async () => {
    const savedPlans: unknown[] = [];
    const persistence = {
      save: vi.fn(async (plan: unknown) => {
        savedPlans.push(plan);
        return plan;
      }),
      load: vi.fn(async () => approvedPlan()),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const runtime = { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService;
    const service = new FeatureWorkflowService({
      runtime,
      persistence,
      loadProjectBrain: () => {
        throw new Error('brain should not load on approval');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue({ ...approvedPlan(), status: 'DRAFT' });
    const approved = await service.approvePlan('workflow-plan-01');
    expect(approved.status).toBe('APPROVED');
    expect(runtime.prepareFeatureTask).not.toHaveBeenCalled();
  });

  it('requires explicit acknowledgement for partial verification completion', async () => {
    const persistence = {
      save: vi.fn(async (plan) => plan),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const runtime = { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService;
    const service = new FeatureWorkflowService({
      runtime,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue({
      ...approvedPlan(),
      tasks: [{ ...approvedPlan().tasks[0]!, status: 'IN_PROGRESS' }],
    });
    await expect(
      service.completeTask('workflow-plan-01', 'task-01', {
        summary: 'Partial pass',
        completedAt: NOW,
        verificationStatus: 'PARTIALLY_PASSED',
      }),
    ).rejects.toThrow(WorkspaceRuntimeError);
  });

  it('keeps correction attached to the same task via prepareTask', async () => {
    const plan = approvedPlan();
    const persistence = {
      save: vi.fn(async (value) => value),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const runtime = {
      prepareFeatureTask: vi.fn(async () => ({
        preparationId: 'prep-001',
        expiresAt: NOW,
        responsePackage: {},
        changePlan: {},
      })),
    } as unknown as WorkspaceRuntimeService;
    const service = new FeatureWorkflowService({
      runtime,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(plan);
    const result = await service.prepareTask(
      { featurePlanId: plan.featurePlanId, taskId: 'task-01' },
      'Implement schema',
    );
    expect(result.plan.tasks[0]?.status).toBe('IN_PROGRESS');
    expect(runtime.prepareFeatureTask).toHaveBeenCalledOnce();
  });

  it('rolls READY tasks back when prepare fails before a preparation exists', async () => {
    const plan = approvedPlan();
    const saves: unknown[] = [];
    const persistence = {
      save: vi.fn(async (value: unknown) => {
        saves.push(value);
        return value;
      }),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const runtime = {
      prepareFeatureTask: vi.fn(async () => {
        throw new WorkspaceRuntimeError('WORKFLOW_FAILED', 'Provider failed.');
      }),
    } as unknown as WorkspaceRuntimeService;
    const service = new FeatureWorkflowService({
      runtime,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(plan);
    await expect(
      service.prepareTask(
        { featurePlanId: plan.featurePlanId, taskId: 'task-01' },
        'Implement schema',
      ),
    ).rejects.toThrow(WorkspaceRuntimeError);
    expect(saves).toHaveLength(2);
    expect((saves[1] as { tasks: { status: string }[] }).tasks[0]?.status).toBe('READY');
  });

  it('keeps IN_PROGRESS when a correction retry prepare fails', async () => {
    const inProgressPlan = {
      ...approvedPlan(),
      tasks: [{ ...approvedPlan().tasks[0]!, status: 'IN_PROGRESS' as const }],
    };
    const saves: unknown[] = [];
    const persistence = {
      save: vi.fn(async (value: unknown) => {
        saves.push(value);
        return value;
      }),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const runtime = {
      prepareFeatureTask: vi.fn(async () => {
        throw new WorkspaceRuntimeError('WORKFLOW_FAILED', 'Provider failed.');
      }),
    } as unknown as WorkspaceRuntimeService;
    const service = new FeatureWorkflowService({
      runtime,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(inProgressPlan);
    await expect(
      service.prepareTask(
        { featurePlanId: inProgressPlan.featurePlanId, taskId: 'task-01' },
        'Fix verification failures',
      ),
    ).rejects.toThrow(WorkspaceRuntimeError);
    expect(saves).toHaveLength(1);
    expect((saves[0] as { tasks: { status: string }[] }).tasks[0]?.status).toBe('IN_PROGRESS');
  });

  it('rolls READY tasks back to READY when provider failures propagate from prepareFeatureTask', async () => {
    const plan = approvedPlan();
    const saves: unknown[] = [];
    const persistence = {
      save: vi.fn(async (value: unknown) => {
        saves.push(value);
        return value;
      }),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const runtime = {
      prepareFeatureTask: vi.fn(async () => {
        throw new ProviderOutputTruncatedError('google-gemini');
      }),
    } as unknown as WorkspaceRuntimeService;
    const service = new FeatureWorkflowService({
      runtime,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(plan);
    await expect(
      service.prepareTask(
        { featurePlanId: plan.featurePlanId, taskId: 'task-01' },
        'Implement schema',
      ),
    ).rejects.toMatchObject({ code: 'OUTPUT_TRUNCATED' });
    expect(saves).toHaveLength(2);
    expect((saves[1] as { tasks: { status: string }[] }).tasks[0]?.status).toBe('READY');
  });

  it('passes iteration feedback and expectedAreas through prepareTask', async () => {
    const plan = {
      ...approvedPlan(),
      tasks: [
        {
          ...approvedPlan().tasks[0]!,
          expectedAreas: ['src/core/feature-decomposition'],
          status: 'IN_PROGRESS' as const,
        },
      ],
    };
    const runtime = {
      prepareFeatureTask: vi.fn(async () => ({
        preparationId: 'prep-002',
        expiresAt: NOW,
        responsePackage: {},
        changePlan: {},
      })),
    } as unknown as WorkspaceRuntimeService;
    const persistence = {
      save: vi.fn(async (value) => value),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const service = new FeatureWorkflowService({
      runtime,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(plan);
    const feedback = buildIterationFeedbackFromCompletion({
      applyResult: APPLIED_RESULT,
      verificationReport: FAILED_VERIFICATION,
    });
    await service.prepareTask(
      { featurePlanId: plan.featurePlanId, taskId: 'task-01' },
      'Fix verification failures',
      feedback,
    );
    expect(runtime.prepareFeatureTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          expectedAreas: ['src/core/feature-decomposition'],
        }),
        iterationFeedback: expect.objectContaining({ kind: 'CORRECTION' }),
      }),
    );
  });

  it('reopens completed tasks for correction and demotes dependent ready tasks', async () => {
    const plan = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: 'workflow-reopen-01',
        sourceRequest: 'Feature',
        title: 'Feature',
        summary: 'Summary',
        status: 'IN_PROGRESS',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-01',
            title: 'Schema',
            objective: 'Add schema',
            scope: 'src/application/workspace',
            order: 1,
            status: 'COMPLETED',
            lastOutcome: { summary: 'Done', completedAt: NOW, verificationStatus: 'PASSED' },
          },
          {
            taskId: 'task-02',
            title: 'Service',
            objective: 'Add service',
            scope: 'src/application/workspace',
            dependencyIds: ['task-01'],
            order: 2,
            status: 'READY',
          },
        ],
      },
      { now: NOW },
    );
    const persistence = {
      save: vi.fn(async (value) => value),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const service = new FeatureWorkflowService({
      runtime: { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(plan);
    const reopened = await service.reopenTaskForCorrection('workflow-reopen-01', 'task-01');
    expect(reopened.tasks.find(({ taskId }) => taskId === 'task-01')?.status).toBe('IN_PROGRESS');
    expect(reopened.tasks.find(({ taskId }) => taskId === 'task-02')?.status).toBe('PENDING');
  });

  it('rejects completion when mandatory verification stages failed', async () => {
    const persistence = {
      save: vi.fn(async (plan) => plan),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const service = new FeatureWorkflowService({
      runtime: { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue({
      ...approvedPlan(),
      tasks: [{ ...approvedPlan().tasks[0]!, status: 'IN_PROGRESS' }],
    });
    await expect(
      service.completeTask(
        'workflow-plan-01',
        'task-01',
        {
          summary: 'Partial pass',
          completedAt: NOW,
          verificationStatus: 'PARTIALLY_PASSED',
          verificationStages: [
            { stage: 'PROJECT_VALIDATION', status: 'PASSED' },
            { stage: 'DEPENDENCY_VALIDATION', status: 'PASSED' },
            { stage: 'BUILD_VALIDATION', status: 'PASSED' },
            { stage: 'TEST_VALIDATION', status: 'FAILED' },
          ],
        },
        { acknowledgePartialPass: true },
      ),
    ).rejects.toThrow(WorkspaceRuntimeError);
  });

  it('rejects approving non-draft plans', async () => {
    const persistence = {
      save: vi.fn(async (plan: unknown) => plan),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const service = new FeatureWorkflowService({
      runtime: { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(approvedPlan());
    await expect(service.approvePlan('workflow-plan-01')).rejects.toThrow(WorkspaceRuntimeError);
  });

  it('loads active plan from persistence cache miss', async () => {
    const plan = approvedPlan();
    const persistence = {
      save: vi.fn(async (value: unknown) => value),
      load: vi.fn(),
      loadActive: vi.fn(async () => plan),
    } as unknown as FeaturePlanPersistence;
    const service = new FeatureWorkflowService({
      runtime: { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    expect(await service.getActivePlan()).toEqual(plan);
    expect(await service.getActivePlan()).toEqual(plan);
    expect(persistence.loadActive).toHaveBeenCalledOnce();
  });

  it('completes, fails, and skips tasks', async () => {
    const persistence = {
      save: vi.fn(async (plan: unknown) => plan),
      load: vi.fn(),
      loadActive: vi.fn(),
    } as unknown as FeaturePlanPersistence;
    const service = new FeatureWorkflowService({
      runtime: { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService,
      persistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue({
      ...approvedPlan(),
      tasks: [{ ...approvedPlan().tasks[0]!, status: 'IN_PROGRESS' }],
    });
    const completed = await service.completeTask('workflow-plan-01', 'task-01', {
      summary: 'Done',
      completedAt: NOW,
      verificationStatus: 'PASSED',
    });
    expect(completed.tasks[0]?.status).toBe('COMPLETED');
    const failed = await service.failTask('workflow-plan-01', 'task-01', {
      summary: 'Failed',
      completedAt: NOW,
      verificationStatus: 'FAILED',
    });
    expect(failed.tasks[0]?.status).toBe('FAILED');
    const skipped = await service.skipTask('workflow-plan-01', 'task-01', 'Not needed');
    expect(skipped.tasks[0]?.status).toBe('SKIPPED');
  });

  it('rejects completion for unknown task', async () => {
    const service = new FeatureWorkflowService({
      runtime: { prepareFeatureTask: vi.fn() } as unknown as WorkspaceRuntimeService,
      persistence: {
        save: vi.fn(),
        load: vi.fn(),
        loadActive: vi.fn(),
      } as unknown as FeaturePlanPersistence,
      loadProjectBrain: () => {
        throw new Error('not needed');
      },
      clock: { now: () => new Date(NOW) },
    });
    vi.spyOn(service, 'loadPlan').mockResolvedValue(approvedPlan());
    await expect(
      service.completeTask('workflow-plan-01', 'missing-task', {
        summary: 'Done',
        completedAt: NOW,
        verificationStatus: 'PASSED',
      }),
    ).rejects.toThrow(WorkspaceRuntimeError);
  });
});
