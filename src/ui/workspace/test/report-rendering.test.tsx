import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkspaceShell } from '../workspace-shell';
import { createWorkflow, PROJECT_VIEW } from './workspace.fixture';

describe('Workspace report rendering', () => {
  it('renders each typed evidence panel after a completed workflow', async () => {
    render(<WorkspaceShell project={PROJECT_VIEW} workflow={createWorkflow()} />);
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Add example.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    await waitFor(() => expect(screen.getAllByText('Workflow complete')).toHaveLength(2));

    fireEvent.click(screen.getByRole('tab', { name: 'Response Package' }));
    expect(screen.getByRole('heading', { name: 'Artifact manifest' })).toBeInTheDocument();
    expect(screen.getByText('src/example.ts')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Change Plan' }));
    expect(screen.getByRole('heading', { name: 'Proposed operations' })).toBeInTheDocument();
    expect(screen.getByText(/creates a new source file/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Apply Result' }));
    expect(screen.getByText('Apply status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Created files' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Verification Report' }));
    expect(screen.getByText('Verification status')).toBeInTheDocument();
    expect(screen.getByText('Test Validation')).toBeInTheDocument();
  }, 30_000);

  it('renders safe scalar stage metadata (string, number, boolean) for Verification stages (P1-8)', async () => {
    render(<WorkspaceShell project={PROJECT_VIEW} workflow={createWorkflow()} />);
    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Add example.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    fireEvent.click(screen.getByRole('button', { name: /approve and apply/i }));
    await waitFor(() => expect(screen.getAllByText('Workflow complete')).toHaveLength(2));

    fireEvent.click(screen.getByRole('tab', { name: 'Verification Report' }));

    expect(screen.getAllByText('Exit Code').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Package Manager')).toBeInTheDocument();
    expect(screen.getByText('npm')).toBeInTheDocument();
    expect(screen.queryByText('Output Bytes')).not.toBeInTheDocument();
    expect(screen.queryByText('Output Truncated')).not.toBeInTheDocument();
  }, 30_000);
});
