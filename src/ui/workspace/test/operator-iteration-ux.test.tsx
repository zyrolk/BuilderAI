import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FeaturePlan } from '../../../application/workspace/feature-plan.types';
import { FeatureWorkflowPanel } from '../feature-workflow-panel';
import { WorkspaceShell } from '../workspace-shell';
import { WorkspaceWorkflowError, type PreparedWorkspaceChange } from '../workspace.types';
import {
  CHANGE_PLAN,
  CORRECTED_CHANGE_PLAN,
  APPLY_RESULT,
  createGate2CorrectionWorkflow,
  createWorkflow,
  PROJECT_VIEW,
  VERIFICATION_REPORT,
} from './workspace.fixture';

const NOW = '2026-08-05T00:00:00.000Z';
const GATE2_TEST_TIMEOUT_MS = 15_000;

async function prepareForGate2Review(request: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Project request'), {
    target: { value: request },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
  await screen.findByRole('heading', { name: 'Review before applying' });
  await screen.findByRole('button', { name: 'Reject / Request correction' });
}

async function openGate2RejectForm(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Reject / Request correction' }));
  await screen.findByRole('button', { name: 'Submit rejection for correction' });
}

function createPlan(
  taskStatus: FeaturePlan['tasks'][number]['status'],
  taskId = 'task-01',
): FeaturePlan {
  return {
    schemaVersion: 1,
    featurePlanId: 'panel-plan-001',
    sourceRequest: 'Add feature',
    title: 'Feature plan',
    summary: 'Summary',
    status: 'IN_PROGRESS',
    createdAt: NOW,
    updatedAt: NOW,
    tasks: [
      {
        taskId,
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

describe('Checkpoint 3 operator iteration UX', () => {
  describe('scenario 1 — Gate 2 rejection', () => {
    it(
      'requests correction, preserves source preparation, and returns to Gate 2 without apply',
      async () => {
        const workflow = createGate2CorrectionWorkflow();
        const prepareGate2 = vi.spyOn(workflow, 'prepareGate2PreservationCorrection');
        const apply = vi.spyOn(workflow, 'apply');

        render(<WorkspaceShell project={PROJECT_VIEW} workflow={workflow} />);

        await prepareForGate2Review('Update index.html copy.');
        await openGate2RejectForm();
        fireEvent.change(screen.getByLabelText(/optional correction guidance/i), {
          target: {
            value: 'Keep the existing component structure and make the smallest safe change.',
          },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Submit rejection for correction' }));

        await waitFor(() =>
          expect(prepareGate2).toHaveBeenCalledWith(
            'Update index.html copy.',
            CHANGE_PLAN,
            'prep-original-001',
            'Keep the existing component structure and make the smallest safe change.',
          ),
        );
        expect(apply).not.toHaveBeenCalled();
        expect(
          await screen.findByText(/correction plan linked to source preparation/i),
        ).toBeInTheDocument();
        expect(screen.getByText('prep-original-001')).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /explicitly approve/i })).not.toBeChecked();
        expect(screen.getByRole('button', { name: /approve and apply/i })).toBeDisabled();
      },
      GATE2_TEST_TIMEOUT_MS,
    );
  });

  describe('scenario 2 — correction failure', () => {
    it(
      'shows an error, keeps the rejected plan inspectable, and allows retry',
      async () => {
        let shouldFail = true;
        const workflow = createGate2CorrectionWorkflow({
          prepareGate2PreservationCorrection: async (request, _changePlan, preparationId) => {
            if (shouldFail) {
              shouldFail = false;
              throw new WorkspaceWorkflowError(
                'CORRECTION_FAILED',
                'Correction service unavailable.',
              );
            }
            return {
              responsePackage: (await createWorkflow().prepare(request)).responsePackage,
              changePlan: CORRECTED_CHANGE_PLAN,
              preparationId: 'prep-corrected-002',
              sourcePreparationId: preparationId,
              isCorrection: true,
            };
          },
        });

        render(<WorkspaceShell project={PROJECT_VIEW} workflow={workflow} />);
        await prepareForGate2Review('Update index.html copy.');
        await openGate2RejectForm();
        fireEvent.click(screen.getByRole('button', { name: 'Submit rejection for correction' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
          /correction service unavailable/i,
        );
        expect(screen.getByRole('heading', { name: 'Review before applying' })).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Submit rejection for correction' }),
        ).not.toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Submit rejection for correction' }));
        await waitFor(() =>
          expect(screen.queryByText(/correction plan linked/i)).toBeInTheDocument(),
        );
      },
      GATE2_TEST_TIMEOUT_MS,
    );
  });

  describe('scenario 3 — corrected plan approval', () => {
    it(
      'applies only the corrected preparation after reject → correct → approve',
      async () => {
        const workflow = createGate2CorrectionWorkflow();
        const apply = vi.spyOn(workflow, 'apply');

        render(<WorkspaceShell project={PROJECT_VIEW} workflow={workflow} />);
        await prepareForGate2Review('Update index.html copy.');
        await openGate2RejectForm();
        fireEvent.click(screen.getByRole('button', { name: 'Submit rejection for correction' }));
        await screen.findByText(/correction plan linked/i);

        fireEvent.click(screen.getByLabelText(/explicitly approve/i));
        fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

        await waitFor(() => expect(apply).toHaveBeenCalledOnce());
        expect(apply).toHaveBeenCalledWith(CORRECTED_CHANGE_PLAN);
        expect(workflow.getLastAppliedPreparationId()).toBe('prep-corrected-002');
      },
      GATE2_TEST_TIMEOUT_MS,
    );
  });

  describe('scenario 8 — repeated correction protection', () => {
    it(
      'issues one correction request while preparation is in flight',
      async () => {
        let resolveCorrection: ((value: PreparedWorkspaceChange) => void) | undefined;
        const correctionPromise = new Promise<PreparedWorkspaceChange>((resolve) => {
          resolveCorrection = resolve;
        });
        const prepareGate2 = vi.fn(async () => correctionPromise);
        const workflow = createGate2CorrectionWorkflow({
          prepareGate2PreservationCorrection: prepareGate2,
        });

        render(<WorkspaceShell project={PROJECT_VIEW} workflow={workflow} />);
        await prepareForGate2Review('Update index.html copy.');
        await openGate2RejectForm();
        fireEvent.click(screen.getByRole('button', { name: 'Submit rejection for correction' }));

        expect(prepareGate2).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('button', { name: 'Preparing correction…' })).toBeDisabled();

        await act(async () =>
          resolveCorrection?.({
            responsePackage: (await workflow.prepare('x')).responsePackage,
            changePlan: CORRECTED_CHANGE_PLAN,
            preparationId: 'prep-corrected-002',
            sourcePreparationId: 'prep-original-001',
            isCorrection: true,
          }),
        );
      },
      GATE2_TEST_TIMEOUT_MS,
    );
  });

  describe('scenario 10 — regression happy path', () => {
    it(
      'prepare → approve → apply → verify remains unchanged',
      async () => {
        const prepare = vi.fn(async () => ({
          responsePackage: (await createWorkflow().prepare('x')).responsePackage,
          changePlan: CHANGE_PLAN,
          preparationId: 'prep-original-001',
        }));
        const apply = vi.fn(async () => APPLY_RESULT);
        const verify = vi.fn(async () => VERIFICATION_REPORT);
        render(
          <WorkspaceShell
            project={PROJECT_VIEW}
            workflow={createGate2CorrectionWorkflow({ prepare, apply, verify })}
          />,
        );

        fireEvent.change(screen.getByLabelText('Project request'), {
          target: { value: 'Create a focused example module.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
        await screen.findByRole('heading', { name: 'Review before applying' });
        fireEvent.click(screen.getByLabelText(/explicitly approve/i));
        fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

        await waitFor(() => expect(verify).toHaveBeenCalledWith(APPLY_RESULT));
        expect(apply).toHaveBeenCalledWith(CHANGE_PLAN);
        expect(screen.getAllByText('Workflow complete').length).toBeGreaterThan(0);
      },
      GATE2_TEST_TIMEOUT_MS,
    );
  });
});

describe('Feature task lifecycle controls', () => {
  it('scenario 4 — marks an in-progress task failed via server action', async () => {
    const failTask = vi.fn(async () => createPlan('FAILED'));
    const featureApi = {
      decompose: vi.fn(),
      loadActivePlan: vi.fn(),
      loadPlan: vi.fn(),
      saveDraft: vi.fn(),
      approvePlan: vi.fn(),
      completeTask: vi.fn(),
      failTask,
      skipTask: vi.fn(),
      reopenTask: vi.fn(),
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onPlanUpdated = vi.fn();

    render(
      <FeatureWorkflowPanel
        plan={createPlan('IN_PROGRESS')}
        onPlanUpdated={onPlanUpdated}
        featureApi={featureApi}
        onExecuteTask={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mark task failed' }));
    fireEvent.change(screen.getByLabelText('Optional reason'), {
      target: { value: 'Prepare loop stuck' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm fail' }));

    await waitFor(() => expect(failTask).toHaveBeenCalledOnce());
    expect(onPlanUpdated).toHaveBeenCalled();
  });

  it('scenario 5 — skips a ready task without auto execution', async () => {
    const skipTask = vi.fn(async () => createPlan('SKIPPED'));
    const onExecuteTask = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <FeatureWorkflowPanel
        plan={createPlan('READY')}
        onPlanUpdated={vi.fn()}
        featureApi={{
          decompose: vi.fn(),
          loadActivePlan: vi.fn(),
          loadPlan: vi.fn(),
          saveDraft: vi.fn(),
          approvePlan: vi.fn(),
          completeTask: vi.fn(),
          failTask: vi.fn(),
          skipTask,
          reopenTask: vi.fn(),
        }}
        onExecuteTask={onExecuteTask}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Skip task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm skip' }));
    await waitFor(() => expect(skipTask).toHaveBeenCalledOnce());
    expect(onExecuteTask).not.toHaveBeenCalled();
  });

  it('scenario 6 — reopens a completed task without auto execution', async () => {
    const reopenTask = vi.fn(async () => createPlan('IN_PROGRESS'));
    const onExecuteTask = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <FeatureWorkflowPanel
        plan={createPlan('COMPLETED')}
        onPlanUpdated={vi.fn()}
        featureApi={{
          decompose: vi.fn(),
          loadActivePlan: vi.fn(),
          loadPlan: vi.fn(),
          saveDraft: vi.fn(),
          approvePlan: vi.fn(),
          completeTask: vi.fn(),
          failTask: vi.fn(),
          skipTask: vi.fn(),
          reopenTask,
        }}
        onExecuteTask={onExecuteTask}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reopen for correction' }));
    await waitFor(() => expect(reopenTask).toHaveBeenCalledOnce());
    expect(onExecuteTask).not.toHaveBeenCalled();
  });

  it('scenario 7 — hides invalid lifecycle controls for failed tasks', () => {
    render(
      <FeatureWorkflowPanel
        plan={createPlan('FAILED')}
        onPlanUpdated={vi.fn()}
        onExecuteTask={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Execute task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen for correction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark task failed' })).not.toBeInTheDocument();
  });
});
