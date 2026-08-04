import { fireEvent, render, screen, within } from '@testing-library/react';

import { ResultPanel } from '../result-panel';
import { WorkspaceShell } from '../workspace-shell';
import {
  formatPreservationPercentage,
  abbreviateChecksum,
} from '../change-plan-preservation-display';
import {
  BASELINE_UNAVAILABLE_CHANGE_PLAN,
  DESTRUCTIVE_PRESERVATION_CHANGE_PLAN,
  LEGACY_UPDATE_CHANGE_PLAN,
  MIXED_OPERATIONS_CHANGE_PLAN,
  SURGICAL_PRESERVATION_CHANGE_PLAN,
} from './change-plan-preservation.fixture';
import { SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN } from '../../../application/workspace/test/smoke-031-marginal-churn.fixture';
import type { ProjectChangePlan } from '../../../core/change-planner';
import { createWorkflow, PROJECT_VIEW, RESPONSE_PACKAGE } from './workspace.fixture';

function renderChangePlanTab(changePlan: ProjectChangePlan) {
  render(
    <ResultPanel activeTab="CHANGE_PLAN" onTabChange={() => undefined} changePlan={changePlan} />,
  );
  return screen.getByRole('tabpanel', { name: 'Change Plan' });
}

function getPreservationSummary(panel: HTMLElement): HTMLElement {
  const heading = within(panel).getByRole('heading', { name: 'Preservation summary' });
  const section = heading.closest('section');
  if (section === null) throw new Error('Expected preservation summary section');
  return section;
}

describe('change plan preservation display helpers', () => {
  it('formats preservation percentages deterministically', () => {
    expect(formatPreservationPercentage(0.8889)).toBe('88.89%');
    expect(formatPreservationPercentage(0.0556)).toBe('5.56%');
  });

  it('abbreviates checksums deterministically', () => {
    const checksum = {
      algorithm: 'sha256',
      value: '1111111111111111111111111111111111111111111111111111111111111111',
    };
    expect(abbreviateChecksum(checksum)).toBe('11111111…11111111');
  });
});

describe('Gate 2 preservation review UI (ADR-030 Slice 3)', () => {
  it('renders preservation summary for UPDATE_FILE operations with metadata', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    expect(
      within(panel).getByRole('heading', { name: 'Preservation summary' }),
    ).toBeInTheDocument();
  });

  it('renders churn and similarity percentages deterministically from metadata', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    expect(within(panel).getByText('88.89%')).toBeInTheDocument();
    expect(within(panel).getByText('11.11%')).toBeInTheDocument();
  });

  it('renders line added/deleted/unchanged counts from metadata', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    expect(within(panel).getByText('10')).toBeInTheDocument();
    expect(within(panel).getByText('16')).toBeInTheDocument();
    expect(within(panel).getByText('2')).toBeInTheDocument();
  });

  it('renders abbreviated baseline and proposed checksums', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    expect(within(panel).getByText('11111111…11111111')).toBeInTheDocument();
    expect(within(panel).getByText('22222222…22222222')).toBeInTheDocument();
  });

  it('labels HIGH churn findings with visible HIGH severity text', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    expect(within(panel).getByText('HIGH')).toBeInTheDocument();
    expect(within(panel).getByText('Preservation High Churn Rewrite')).toBeInTheDocument();
  });

  it('renders elevated churn and large deletion findings from metadata', () => {
    const panel = renderChangePlanTab(MIXED_OPERATIONS_CHANGE_PLAN);
    expect(within(panel).getByText('Preservation Elevated Churn')).toBeInTheDocument();
    expect(within(panel).getByText('Preservation Large Deletion')).toBeInTheDocument();
  });

  it('renders removed HTML ids and aria attributes without exceeding supplied metadata', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    const summary = getPreservationSummary(panel);
    expect(
      within(summary).getByText('app-root, counter-heading, counter-value, increment-counter'),
    ).toBeInTheDocument();
    expect(within(summary).getByText('aria-label, aria-live, aria-labelledby')).toBeInTheDocument();
    expect(within(summary).queryByText('reset-counter')).not.toBeInTheDocument();
  });

  it('renders cross-file reference risks from metadata', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    const summary = getPreservationSummary(panel);
    expect(within(summary).getByText(/Cross-file reference risks:/)).toBeInTheDocument();
    expect(within(summary).getAllByText('counter-value').length).toBeGreaterThan(0);
    expect(within(summary).getAllByText('assets/app.js').length).toBeGreaterThan(0);
  });

  it('renders baseline unavailable warning without fake metrics', () => {
    const panel = renderChangePlanTab(BASELINE_UNAVAILABLE_CHANGE_PLAN);
    expect(within(panel).getByText(/Baseline unavailable:/)).toBeInTheDocument();
    expect(within(panel).queryByText('Churn')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Similarity')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Preservation summary')).not.toBeInTheDocument();
  });

  it('renders legacy UPDATE_FILE operations without preservation sections', () => {
    const panel = renderChangePlanTab(LEGACY_UPDATE_CHANGE_PLAN);
    expect(within(panel).getByText('src/legacy.ts')).toBeInTheDocument();
    expect(within(panel).queryByText('Preservation summary')).not.toBeInTheDocument();
  });

  it('leaves CREATE_FILE and DELETE_FILE rendering unchanged', () => {
    const panel = renderChangePlanTab(MIXED_OPERATIONS_CHANGE_PLAN);
    expect(within(panel).getByText('src/new.ts')).toBeInTheDocument();
    expect(within(panel).getByText('old/file.ts')).toBeInTheDocument();
    expect(within(panel).getAllByText('Preservation summary')).toHaveLength(1);
  });

  it('preserves deterministic finding order supplied by the engine', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    const summary = getPreservationSummary(panel);
    const findingsBlock = within(summary)
      .getByRole('heading', { name: 'Preservation findings' })
      .closest('div');
    if (findingsBlock === null) throw new Error('Expected preservation findings block');
    const findingItems = within(findingsBlock).getAllByRole('listitem');
    expect(findingItems.map((item) => within(item).getByText(/Preservation /).textContent)).toEqual(
      [
        'Preservation Cross File Reference Risk',
        'Preservation High Churn Rewrite',
        'Preservation Removed Aria Attribute',
        'Preservation Removed Html Id',
      ],
    );
  });

  it('does not display raw baseline file content', () => {
    renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    expect(screen.queryByText(/<!DOCTYPE html>/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aria-labelledby="counter-heading"/)).not.toBeInTheDocument();
  });

  it('exposes accessible preservation summary headings', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    expect(
      within(panel).getByRole('heading', { level: 4, name: 'Preservation summary' }),
    ).toBeInTheDocument();
  });

  it('exposes accessible baseline-unavailable headings', () => {
    const panel = renderChangePlanTab(BASELINE_UNAVAILABLE_CHANGE_PLAN);
    expect(
      within(panel).getByRole('heading', { level: 4, name: 'Preservation analysis' }),
    ).toBeInTheDocument();
  });

  it('shows Smoke #2 destructive fixture with HIGH churn, removed ids, and cross-file risk', () => {
    const panel = renderChangePlanTab(DESTRUCTIVE_PRESERVATION_CHANGE_PLAN);
    const summary = getPreservationSummary(panel);
    expect(within(summary).getByText('88.89%')).toBeInTheDocument();
    expect(
      within(summary).getByText('app-root, counter-heading, counter-value, increment-counter'),
    ).toBeInTheDocument();
    expect(within(summary).getByText(/Cross-file reference risks:/)).toBeInTheDocument();
    expect(within(summary).getByText('CRITICAL')).toBeInTheDocument();
  });

  it('shows surgical fixture with low preservation summary and no HIGH warning', () => {
    const panel = renderChangePlanTab(SURGICAL_PRESERVATION_CHANGE_PLAN);
    expect(within(panel).getByText('5.56%')).toBeInTheDocument();
    expect(within(panel).getByText('94.74%')).toBeInTheDocument();
    expect(within(panel).queryByText('Preservation High Churn Rewrite')).not.toBeInTheDocument();
    expect(within(panel).queryByText('HIGH')).not.toBeInTheDocument();
  });

  it('shows EXCELLENT structured surgicality alongside elevated line churn diagnostic', () => {
    const panel = renderChangePlanTab(SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN);
    const summary = getPreservationSummary(panel);
    expect(within(summary).getByText('EXCELLENT')).toBeInTheDocument();
    expect(within(summary).getByText('Structured HTML')).toBeInTheDocument();
    expect(within(summary).getByText('Attributes changed')).toBeInTheDocument();
    expect(within(summary).getByText('44.44%')).toBeInTheDocument();
    expect(within(summary).getByText('Preservation Elevated Churn')).toBeInTheDocument();
  });

  it('keeps Gate 2 approval controls unchanged when preservation metadata is present', async () => {
    render(
      <WorkspaceShell
        project={PROJECT_VIEW}
        workflow={createWorkflow({
          prepare: async () => ({
            responsePackage: RESPONSE_PACKAGE,
            changePlan: DESTRUCTIVE_PRESERVATION_CHANGE_PLAN,
          }),
        })}
      />,
    );

    fireEvent.change(screen.getByLabelText('Project request'), {
      target: { value: 'Update counter page.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare change plan' }));
    await screen.findByRole('heading', { name: 'Review before applying' });

    const approveButton = screen.getByRole('button', { name: /approve and apply/i });
    expect(approveButton).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/explicitly approve/i));
    expect(approveButton).toBeEnabled();
  });
});
