import { fireEvent, render, screen } from '@testing-library/react';

import { WorkspaceShell } from '../workspace-shell';
import { PROJECT_VIEW } from './workspace.fixture';

describe('WorkspaceShell rendering', () => {
  it('renders the three-column workspace information and safe disconnected state', () => {
    render(<WorkspaceShell project={PROJECT_VIEW} />);

    expect(screen.getByRole('heading', { level: 1, name: 'BuilderAI' })).toBeInTheDocument();
    expect(screen.getByText('Core boundaries validated')).toBeInTheDocument();
    expect(screen.getAllByText('Ready for request')).toHaveLength(2);
    expect(
      screen.getByRole('heading', { name: /what should builderai change/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('log')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /workflow results/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prepare change plan/i })).toBeDisabled();
    expect(screen.getByText(/runtime execution is disabled/i)).toBeInTheDocument();
  });

  it('provides labelled request input and keyboard-operable result tabs', () => {
    render(<WorkspaceShell project={PROJECT_VIEW} />);

    expect(screen.getByLabelText('Project request')).toHaveAttribute('maxlength', '4000');
    const responseTab = screen.getByRole('tab', { name: 'Response Package' });
    const planTab = screen.getByRole('tab', { name: 'Change Plan' });
    expect(responseTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(planTab);

    expect(planTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Change Plan');
    expect(screen.getByText(/reviewable plan will appear/i)).toBeInTheDocument();

    fireEvent.keyDown(planTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Diff' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Investigation' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Investigation' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Apply Result' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
