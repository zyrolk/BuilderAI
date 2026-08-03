import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { WorkspaceShell } from '../workspace-shell';
import { WorkspaceWorkflowError } from '../workspace.types';
import {
  APPLY_RESULT,
  CHANGE_PLAN,
  createWorkflow,
  FAILED_APPLY_RESULT,
  PARTIALLY_APPLIED_RESULT,
  PROJECT_VIEW,
  REJECTED_APPLY_RESULT,
  RESPONSE_PACKAGE,
  VERIFICATION_REPORT,
} from './workspace.fixture';

describe('Workspace workflow transitions', () => {
  it('shows processing progress while preparation is pending', async () => {
    let resolvePreparation:
      | ((value: {
          responsePackage: typeof RESPONSE_PACKAGE;
          changePlan: typeof CHANGE_PLAN;
        }) => void)
      | undefined;
    const preparation = new Promise<{
      responsePackage: typeof RESPONSE_PACKAGE;
      changePlan: typeof CHANGE_PLAN;
    }>((resolve) => {
      resolvePreparation = resolve;
    });
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createWorkflow({ prepare: async () => preparation })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Prepare work.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    expect(screen.getAllByText('Preparing response and change plan')).toHaveLength(2);
    expect(screen.getByText('Response packaged').closest('li')).toHaveAttribute(
      'data-state',
      'current',
    );

    await act(async () =>
      resolvePreparation?.({ responsePackage: RESPONSE_PACKAGE, changePlan: CHANGE_PLAN }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Review before applying' }),
    ).toBeInTheDocument();
  });

  it('moves from request through explicit approval, apply, and verification', async () => {
    const prepare = vi.fn(async () => ({
      responsePackage: RESPONSE_PACKAGE,
      changePlan: CHANGE_PLAN,
    }));
    const apply = vi.fn(async () => APPLY_RESULT);
    const verify = vi.fn(async () => VERIFICATION_REPORT);
    render(<WorkspaceShell project={PROJECT_VIEW} workflow={{ prepare, apply, verify }} />);

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Create a focused example module.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    expect(
      await screen.findByRole('heading', { name: 'Review before applying' }),
    ).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledWith('Create a focused example module.');
    expect(screen.getByText('Create File')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve and apply/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Response Package' }));
    expect(screen.getByRole('heading', { name: 'Artifact manifest' })).toBeInTheDocument();
    expect(screen.getByText('src/example.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Change Plan' }));
    expect(screen.getByText('Create File')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/explicitly approve these file operations/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

    await waitFor(() => expect(verify).toHaveBeenCalledWith(APPLY_RESULT));
    expect(apply).toHaveBeenCalledWith(CHANGE_PLAN);
    expect(screen.getAllByText('Workflow complete')).toHaveLength(2);
    expect(screen.getByText('Verification status')).toBeInTheDocument();
    expect(screen.getByText('Project Validation')).toBeInTheDocument();
    expect(screen.getByText(/verification completed with status passed/i)).toBeInTheDocument();
  }, 15_000);

  it('stops after a non-applied result and does not start verification', async () => {
    const verify = vi.fn(async () => VERIFICATION_REPORT);
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createWorkflow({ apply: async () => REJECTED_APPLY_RESULT, verify })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Change a file.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/verification was not started/i);
    expect(verify).not.toHaveBeenCalled();
    expect(screen.getByText('Apply status')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  }, 15_000);

  it('proceeds into verification for a PARTIALLY_APPLIED result and renders the real report (P1-7)', async () => {
    const apply = vi.fn(async () => PARTIALLY_APPLIED_RESULT);
    const verify = vi.fn(async () => VERIFICATION_REPORT);
    render(<WorkspaceShell project={PROJECT_VIEW} workflow={createWorkflow({ apply, verify })} />);
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Change several files.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

    await waitFor(() => expect(verify).toHaveBeenCalledWith(PARTIALLY_APPLIED_RESULT));
    expect(screen.getAllByText('Workflow complete')).toHaveLength(2);
    fireEvent.click(screen.getByRole('tab', { name: 'Verification Report' }));
    expect(screen.getByText('Verification status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Apply Result' }));
    expect(screen.getByText('Partially Applied')).toBeInTheDocument();
  });

  it('stops after a FAILED result and does not start verification (P1-7)', async () => {
    const verify = vi.fn(async () => VERIFICATION_REPORT);
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createWorkflow({ apply: async () => FAILED_APPLY_RESULT, verify })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Change a file.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/verification was not started/i);
    expect(verify).not.toHaveBeenCalled();
    expect(screen.getByText('Apply status')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('reports preparation failure without exposing implementation details', async () => {
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createWorkflow({
          prepare: async () => {
            throw new Error('secret failure');
          },
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Prepare work.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be prepared/i);
    expect(alert).not.toHaveTextContent('secret failure');
    expect(screen.getAllByText('Workflow stopped')).toHaveLength(3);
  });

  it('shows a bounded server workflow diagnostic to the user', async () => {
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createWorkflow({
          prepare: async () => {
            throw new WorkspaceWorkflowError(
              'CONTEXT_BUILDER_VALIDATION_FAILED',
              "Context Builder validation failed: source reference 'project-brain.json' is unavailable.",
            );
          },
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Prepare work.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /source reference 'project-brain.json' is unavailable/i,
    );
  });

  it('retains the apply result when verification fails safely', async () => {
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createWorkflow({
          verify: async () => {
            throw new Error('private runner output');
          },
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Apply then verify.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not complete/i);
    expect(screen.queryByText('private runner output')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Apply Result' }));
    expect(screen.getByText('Apply status')).toBeInTheDocument();
    expect(screen.getByText('Applied')).toBeInTheDocument();
  });
});
