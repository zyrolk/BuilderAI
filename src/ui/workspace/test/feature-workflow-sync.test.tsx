import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FeaturePlan } from '../../../application/workspace/feature-plan.types';
import { FeatureWorkflowPanel } from '../feature-workflow-panel';
import type { VerificationReport } from '../../../core/verification';
import { APPLY_RESULT } from './workspace.fixture';

const NOW = '2026-08-01T00:00:00.000Z';

function createPlan(taskStatus: FeaturePlan['tasks'][number]['status']): FeaturePlan {
  return {
    schemaVersion: 1,
    featurePlanId: 'panel-plan-001',
    sourceRequest: 'Add feature',
    title: 'Feature plan',
    summary: 'Summary',
    status: 'APPROVED',
    createdAt: NOW,
    updatedAt: NOW,
    tasks: [
      {
        taskId: 'task-01',
        title: 'Implement API',
        objective: 'Add API routes',
        scope: 'src/app/api',
        dependencyIds: [],
        expectedAreas: ['src/app/api'],
        acceptanceCriteria: ['Routes validate input'],
        order: 1,
        status: taskStatus,
      },
    ],
  };
}

const PASSED_VERIFICATION: VerificationReport = {
  schemaVersion: 1,
  status: 'PASSED',
  stages: [],
  warnings: [],
  errors: [],
  durationMs: 1,
  metadata: {},
};

describe('FeatureWorkflowPanel synchronization', () => {
  it('shows Complete task after server plan is IN_PROGRESS and verification passes', async () => {
    const onExecuteTask = vi.fn(async () => undefined);
    const { rerender } = render(
      <FeatureWorkflowPanel
        plan={createPlan('READY')}
        onPlanUpdated={vi.fn()}
        onExecuteTask={onExecuteTask}
        activeTaskId="task-01"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Execute task' }));
    expect(onExecuteTask).toHaveBeenCalledOnce();

    rerender(
      <FeatureWorkflowPanel
        plan={createPlan('IN_PROGRESS')}
        onPlanUpdated={vi.fn()}
        onExecuteTask={onExecuteTask}
        activeTaskId="task-01"
        applyResult={APPLY_RESULT}
        verificationReport={PASSED_VERIFICATION}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Complete task' })).toBeInTheDocument();
  });

  it('refreshes downstream readiness after completion', async () => {
    const completeTask = vi.fn(async () => createPlan('COMPLETED'));
    const featureApi = {
      decompose: vi.fn(),
      loadActivePlan: vi.fn(),
      loadPlan: vi.fn(),
      saveDraft: vi.fn(),
      approvePlan: vi.fn(),
      completeTask,
      failTask: vi.fn(),
      skipTask: vi.fn(),
    };
    const onPlanUpdated = vi.fn();
    render(
      <FeatureWorkflowPanel
        plan={createPlan('IN_PROGRESS')}
        onPlanUpdated={onPlanUpdated}
        featureApi={featureApi}
        onExecuteTask={vi.fn()}
        activeTaskId="task-01"
        applyResult={APPLY_RESULT}
        verificationReport={PASSED_VERIFICATION}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Complete task' }));
    await waitFor(() => expect(completeTask).toHaveBeenCalledOnce());
    await waitFor(() => expect(onPlanUpdated).toHaveBeenCalled());
  });
});
