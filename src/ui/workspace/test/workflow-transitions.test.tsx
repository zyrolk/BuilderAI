import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { WorkspaceShell } from '../workspace-shell';
import {
  APPLY_RESULT,
  CHANGE_PLAN,
  createWorkflow,
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

    fireEvent.click(screen.getByLabelText(/explicitly approve these file operations/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));

    await waitFor(() => expect(verify).toHaveBeenCalledWith(APPLY_RESULT));
    expect(apply).toHaveBeenCalledWith(CHANGE_PLAN);
    expect(screen.getAllByText('Workflow complete')).toHaveLength(2);
    expect(screen.getByText('Verification status')).toBeInTheDocument();
    expect(screen.getByText('Project Validation')).toBeInTheDocument();
    expect(screen.getByText(/verification completed with status passed/i)).toBeInTheDocument();
  });

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
