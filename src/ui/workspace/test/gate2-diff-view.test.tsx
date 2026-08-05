import { fireEvent, render, screen, within } from '@testing-library/react';

import {
  GATE2_DIFF_TRUNCATION_MESSAGE,
  GATE2_PROTECTED_DIFF_MESSAGE,
  GATE2_TOTAL_TRUNCATION_MESSAGE,
} from '../../../application/workspace/gate2-review/gate2-review-configuration';
import {
  createCreateOperation,
  createDeleteOperation,
  createPlanFromOperations,
  createUpdateOperation,
  projectGate2ReviewForPlan,
} from '../../../application/workspace/gate2-review/gate2-review.fixture';
import { Gate2DiffView } from '../gate2-diff-view';
import { ResultPanel } from '../result-panel';
import { WorkspaceShell } from '../workspace-shell';
import {
  CHANGE_PLAN,
  createGate2CorrectionWorkflow,
  createWorkflow,
  GATE2_REVIEW,
  PROJECT_VIEW,
} from './workspace.fixture';

function renderDiffTab(gate2Review = GATE2_REVIEW) {
  render(
    <ResultPanel
      activeTab="DIFF"
      onTabChange={() => undefined}
      changePlan={CHANGE_PLAN}
      gate2Review={gate2Review}
    />,
  );
  return screen.getByRole('tabpanel', { name: 'Diff' });
}

describe('Gate2DiffView', () => {
  it('shows placeholder guidance before a plan is prepared', () => {
    render(<Gate2DiffView />);
    expect(
      screen.getByText(/line-level diff will appear after a change plan is prepared/i),
    ).toBeInTheDocument();
  });

  it('renders UPDATE_FILE removed and added lines with accessible diff label', () => {
    const review = projectGate2ReviewForPlan(
      createPlanFromOperations([
        createUpdateOperation('src/config.ts', 'const limit = 10;\n', 'const limit = 20;\n'),
      ]),
      { 'src/config.ts': 'const limit = 10;\n' },
    );
    const panel = renderDiffTab(review);

    expect(within(panel).getByText('UPDATE FILE')).toBeInTheDocument();
    expect(within(panel).getByText('src/config.ts')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Unified diff for src/config.ts')).toHaveTextContent(
      '-const limit = 10;',
    );
    expect(within(panel).getByLabelText('Unified diff for src/config.ts')).toHaveTextContent(
      '+const limit = 20;',
    );
  });

  it('renders CREATE_FILE as NEW FILE additions', () => {
    const review = projectGate2ReviewForPlan(
      createPlanFromOperations([
        createCreateOperation('src/new.ts', 'export const created = true;\n'),
      ]),
    );
    const panel = renderDiffTab(review);

    expect(within(panel).getByText('NEW FILE')).toBeInTheDocument();
    expect(within(panel).getByLabelText('Unified diff for src/new.ts')).toHaveTextContent(
      '+export const created = true;',
    );
  });

  it('renders DELETE FILE with protected-path masking for mandatory protected targets', () => {
    const deleteReview = projectGate2ReviewForPlan(
      createPlanFromOperations([createDeleteOperation('project-brain.json')]),
      { 'project-brain.json': '{"secret":"value"}\n' },
    );
    const panel = renderDiffTab(deleteReview);

    expect(within(panel).getByText('DELETE FILE')).toBeInTheDocument();
    expect(within(panel).getByText(GATE2_PROTECTED_DIFF_MESSAGE)).toBeInTheDocument();
    expect(within(panel).queryByText('{"secret":"value"}')).not.toBeInTheDocument();
  });

  it('masks protected UPDATE_FILE content from review projection', () => {
    const protectedReview = projectGate2ReviewForPlan(
      createPlanFromOperations([createUpdateOperation('project-brain.json', '{}', '{"x":1}')]),
      { 'project-brain.json': '{}' },
    );
    const panel = renderDiffTab(protectedReview);

    expect(within(panel).getByText(GATE2_PROTECTED_DIFF_MESSAGE)).toBeInTheDocument();
    expect(within(panel).queryByText('{"x":1}')).not.toBeInTheDocument();
  });

  it('shows explicit truncation warnings for large diffs', () => {
    const review = {
      ...projectGate2ReviewForPlan(
        createPlanFromOperations([createCreateOperation('src/big.ts', `${'x'.repeat(200)}\n`)]),
      ),
      truncated: true,
      truncationMessage: GATE2_TOTAL_TRUNCATION_MESSAGE,
      operationDiffs: [
        {
          ...projectGate2ReviewForPlan(
            createPlanFromOperations([createCreateOperation('src/big.ts', `${'x'.repeat(200)}\n`)]),
          ).operationDiffs[0]!,
          truncated: true,
          truncationMessage: GATE2_DIFF_TRUNCATION_MESSAGE,
        },
      ],
    };
    const panel = renderDiffTab(review);

    expect(within(panel).getByRole('heading', { name: 'Diff truncated' })).toBeInTheDocument();
    expect(within(panel).getByText(GATE2_TOTAL_TRUNCATION_MESSAGE)).toBeInTheDocument();
    expect(within(panel).getByText(GATE2_DIFF_TRUNCATION_MESSAGE)).toBeInTheDocument();
  });

  it('renders separate sections for multi-file plans', () => {
    const review = projectGate2ReviewForPlan(
      createPlanFromOperations([
        createUpdateOperation('src/a.ts', 'a\n', 'b\n'),
        createCreateOperation('src/b.ts', 'new\n'),
      ]),
      { 'src/a.ts': 'a\n' },
    );
    const panel = renderDiffTab(review);

    expect(within(panel).getByText('src/a.ts')).toBeInTheDocument();
    expect(within(panel).getByText('src/b.ts')).toBeInTheDocument();
  });
});

describe('Gate 2 diff tab integration', () => {
  it('scenario 9 — existing prepare flow remains functional and exposes the Diff tab', async () => {
    render(<WorkspaceShell project={PROJECT_VIEW} workflow={createWorkflow()} />);

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Create a focused example module.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));

    expect(
      await screen.findByRole('heading', { name: 'Review before applying' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('NEW FILE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve and apply/i })).toBeDisabled();
  });

  it('scenario 8 — corrected preparation shows corrected diff while approval stays reset', async () => {
    const workflow = createGate2CorrectionWorkflow();
    render(<WorkspaceShell project={PROJECT_VIEW} workflow={workflow} />);

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Create example.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByText('src/example.ts');

    fireEvent.click(screen.getByRole('button', { name: 'Reject / Request correction' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit rejection for correction' }));

    expect(await screen.findByText('src/example-corrected.ts')).toBeInTheDocument();
    expect(screen.queryByText('src/example.ts')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Unified diff for src/example-corrected.ts')).toHaveTextContent(
      '+export const example = true;',
    );
    expect(screen.getByRole('checkbox', { name: /explicitly approve/i })).not.toBeChecked();
  });
});
