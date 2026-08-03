import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { vi } from 'vitest';

import { WorkspaceShell } from '../workspace-shell';
import { WorkspaceWorkflowError } from '../workspace.types';
import { PREPARATION_COMPLETED, REPRESENTATIVE_ACTIVITIES } from './activity-history.fixture';
import {
  APPLY_RESULT,
  CHANGE_PLAN,
  createWorkflow,
  PROJECT_VIEW,
  RESPONSE_PACKAGE,
  VERIFICATION_REPORT,
} from './workspace.fixture';

function createHistoryWorkflow(
  loadActivityHistory: () => Promise<{
    schemaVersion: 1;
    activities: typeof REPRESENTATIVE_ACTIVITIES;
  }>,
  overrides: Parameters<typeof createWorkflow>[0] = {},
) {
  return createWorkflow({
    loadActivityHistory,
    ...overrides,
  });
}

function historyListbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Recent workspace activities' });
}

describe('WorkspaceShell activity history integration', () => {
  it('loads history when runtime is available and live activities reach ActivityHistoryPanel', async () => {
    const loadActivityHistory = vi.fn(async () => ({
      schemaVersion: 1 as const,
      activities: REPRESENTATIVE_ACTIVITIES,
    }));

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory)}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Activity history' })).toBeInTheDocument();
    expect(loadActivityHistory).toHaveBeenCalledTimes(1);
    expect(screen.getByText(`${REPRESENTATIVE_ACTIVITIES.length} records`)).toBeInTheDocument();
    expect(within(historyListbox()).getByText('Verification')).toBeInTheDocument();
  });

  it('renders the existing empty state when history is empty', async () => {
    const loadActivityHistory = vi.fn(async () => ({
      schemaVersion: 1 as const,
      activities: [],
    }));

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory)}
      />,
    );

    expect(
      await screen.findByText('No workspace activity has been recorded yet.'),
    ).toBeInTheDocument();
  });

  it('shows an accessible initial loading state', async () => {
    let resolveHistory:
      ((value: { schemaVersion: 1; activities: readonly [] }) => void) | undefined;
    const historyPromise = new Promise<{ schemaVersion: 1; activities: readonly [] }>((resolve) => {
      resolveHistory = resolve;
    });
    const loadActivityHistory = vi.fn(async () => historyPromise);

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory)}
      />,
    );

    expect(screen.getByText('Loading activity history…')).toBeInTheDocument();

    await act(async () => {
      resolveHistory?.({ schemaVersion: 1, activities: [] });
    });

    expect(
      await screen.findByText('No workspace activity has been recorded yet.'),
    ).toBeInTheDocument();
  });

  it('renders a generic safe error without raw server text on initial load failure', async () => {
    const loadActivityHistory = vi.fn(async () => {
      throw new WorkspaceWorkflowError(
        'INTERNAL_WORKFLOW_ERROR',
        'ENOENT: disk exploded at D:\\projects2\\secret',
      );
    });

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory)}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Activity history could not be loaded.',
    );
    expect(screen.queryByText(/ENOENT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/disk exploded/)).not.toBeInTheDocument();
  });

  it('refreshes history after successful preparation', async () => {
    const loadActivityHistory = vi
      .fn()
      .mockResolvedValueOnce({ schemaVersion: 1 as const, activities: [] })
      .mockResolvedValueOnce({
        schemaVersion: 1 as const,
        activities: [PREPARATION_COMPLETED],
      });
    const prepare = vi.fn(async () => ({
      responsePackage: RESPONSE_PACKAGE,
      changePlan: CHANGE_PLAN,
    }));

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory, { prepare })}
      />,
    );

    await screen.findByText('No workspace activity has been recorded yet.');

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Prepare work.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    expect(
      await screen.findByRole('heading', { name: 'Review before applying' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(loadActivityHistory).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(historyListbox()).getByText('Task preparation')).toBeInTheDocument(),
    );
  });

  it('refreshes history after failed preparation without corrupting workflow state', async () => {
    const loadActivityHistory = vi
      .fn()
      .mockResolvedValueOnce({ schemaVersion: 1 as const, activities: [] })
      .mockResolvedValueOnce({ schemaVersion: 1 as const, activities: [] });
    const prepare = vi.fn(async () => {
      throw new WorkspaceWorkflowError('WORKSPACE_REQUEST_FAILED', 'Provider unavailable.');
    });

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory, { prepare })}
      />,
    );

    await screen.findByText('No workspace activity has been recorded yet.');

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Prepare work.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Workflow stopped');
    await waitFor(() => expect(loadActivityHistory).toHaveBeenCalledTimes(2));
  });

  it('refreshes history after apply and verification complete', async () => {
    const loadActivityHistory = vi
      .fn()
      .mockResolvedValueOnce({ schemaVersion: 1 as const, activities: [] })
      .mockResolvedValueOnce({ schemaVersion: 1 as const, activities: [PREPARATION_COMPLETED] })
      .mockResolvedValueOnce({
        schemaVersion: 1 as const,
        activities: REPRESENTATIVE_ACTIVITIES,
      });
    const prepare = vi.fn(async () => ({
      responsePackage: RESPONSE_PACKAGE,
      changePlan: CHANGE_PLAN,
    }));
    const apply = vi.fn(async () => APPLY_RESULT);
    const verify = vi.fn(async () => VERIFICATION_REPORT);

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory, { prepare, apply, verify })}
      />,
    );

    await screen.findByText('No workspace activity has been recorded yet.');

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Apply work.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    expect(
      await screen.findByRole('heading', { name: 'Review before applying' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/I reviewed this plan/i));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    });

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(loadActivityHistory).toHaveBeenCalledTimes(3));
  });

  it('keeps previous history visible while refresh is pending and silent on refresh failure', async () => {
    let pendingReject: ((reason?: unknown) => void) | undefined;
    const loadActivityHistory = vi
      .fn()
      .mockResolvedValueOnce({
        schemaVersion: 1 as const,
        activities: REPRESENTATIVE_ACTIVITIES,
      })
      .mockImplementationOnce(
        () =>
          new Promise<{ schemaVersion: 1; activities: typeof REPRESENTATIVE_ACTIVITIES }>(
            (_resolve, reject) => {
              pendingReject = reject;
            },
          ),
      );

    const prepare = vi.fn(async () => ({
      responsePackage: RESPONSE_PACKAGE,
      changePlan: CHANGE_PLAN,
    }));

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        runtimeAvailable
        workflow={createHistoryWorkflow(loadActivityHistory, { prepare })}
      />,
    );

    await screen.findByRole('heading', { name: 'Activity history' });
    expect(within(historyListbox()).getByText('Verification')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Prepare again.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    await waitFor(() =>
      expect(screen.getByText('Refreshing activity history…')).toBeInTheDocument(),
    );
    expect(within(historyListbox()).getByText('Verification')).toBeInTheDocument();

    await act(async () => {
      pendingReject?.(new WorkspaceWorkflowError('WORKFLOW_FAILED', 'raw refresh failure'));
    });

    await waitFor(() => expect(loadActivityHistory).toHaveBeenCalledTimes(2));
    expect(within(historyListbox()).getByText('Verification')).toBeInTheDocument();
    expect(screen.queryByText('raw refresh failure')).not.toBeInTheDocument();
  });

  it('does not call history API when runtimeAvailable is false', async () => {
    const loadActivityHistory = vi.fn(async () => ({
      schemaVersion: 1 as const,
      activities: REPRESENTATIVE_ACTIVITIES,
    }));

    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createHistoryWorkflow(loadActivityHistory)}
      />,
    );

    expect(screen.queryByRole('heading', { name: 'Activity history' })).not.toBeInTheDocument();
    expect(loadActivityHistory).not.toHaveBeenCalled();
  });
});
