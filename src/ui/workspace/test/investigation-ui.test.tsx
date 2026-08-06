import { fireEvent, render, screen } from '@testing-library/react';

import { ResultPanel } from '../result-panel';
import { WorkspaceShell } from '../workspace-shell';
import {
  createWorkflow,
  GATE2_REVIEW,
  PROJECT_VIEW,
  RESPONSE_PACKAGE,
  CHANGE_PLAN,
} from './workspace.fixture';
import {
  createInvestigationServiceForFixture,
  createZyroStyleInvestigationSource,
} from '../../../application/workspace/investigation/investigation.fixture';

describe('Investigation UI', () => {
  it('scenario 10 — normal prepare workflow remains functional', async () => {
    render(<WorkspaceShell project={PROJECT_VIEW} workflow={createWorkflow()} />);

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Create a focused example module.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    expect(
      await screen.findByRole('heading', { name: 'Review before applying' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders investigation report with claim badges', async () => {
    const service = createInvestigationServiceForFixture(createZyroStyleInvestigationSource());
    const investigation = await service.investigate('Investigate cancelSupplierOrder.');

    render(
      <ResultPanel
        activeTab="INVESTIGATION"
        onTabChange={() => undefined}
        investigation={investigation}
      />,
    );

    expect(screen.getByRole('tabpanel', { name: 'Investigation' })).toBeInTheDocument();
    expect(screen.getAllByText('FACT').length).toBeGreaterThan(0);
    expect(screen.getByText(/Confidence:/i)).toBeInTheDocument();
  });

  it('exposes Investigate action and Prepare fix handoff without apply controls', async () => {
    const investigation = await createInvestigationServiceForFixture(
      createZyroStyleInvestigationSource(),
    ).investigate('Investigate cancelSupplierOrder.');

    const workflow = createWorkflow({
      investigate: async () => investigation,
      prepare: async () => ({
        responsePackage: RESPONSE_PACKAGE,
        changePlan: CHANGE_PLAN,
        gate2Review: GATE2_REVIEW,
        preparationId: 'prep-after-investigation',
      }),
    });

    render(<WorkspaceShell project={PROJECT_VIEW} workflow={workflow} />);

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Investigate cancelSupplierOrder.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Investigate' }));

    expect(await screen.findByRole('heading', { name: 'Next action' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve and apply/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare fix' }));
    expect(
      await screen.findByRole('heading', { name: 'Review before applying' }),
    ).toBeInTheDocument();
  });
});
