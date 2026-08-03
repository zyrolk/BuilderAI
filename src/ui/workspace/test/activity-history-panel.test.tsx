import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ActivityHistoryPanel } from '../activity-history-panel';
import {
  APPLY_COMPLETED,
  APPLY_FAILED,
  PREPARATION_COMPLETED,
  REPRESENTATIVE_ACTIVITIES,
  UNSAFE_FIXTURE_MARKERS,
  VERIFICATION_COMPLETED,
} from './activity-history.fixture';

describe('ActivityHistoryPanel', () => {
  it('renders an accessible empty state', () => {
    render(<ActivityHistoryPanel activities={[]} />);
    expect(screen.getByRole('heading', { name: 'Activity history' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'No workspace activity has been recorded yet.',
    );
  });

  it('renders preparation activity label, status, timestamp, and affected paths', () => {
    render(<ActivityHistoryPanel activities={[PREPARATION_COMPLETED]} />);
    expect(screen.getAllByText('Task preparation').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(
      document.querySelectorAll('time[datetime="2026-08-03T12:00:00.000Z"]').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText('src/application/workspace/workspace-runtime.service.ts'),
    ).toBeInTheDocument();
    expect(screen.getByText('src/ui/workspace/activity-history-panel.tsx')).toBeInTheDocument();
  });

  it('renders apply completed status and paths', () => {
    render(<ActivityHistoryPanel activities={[APPLY_COMPLETED]} />);
    expect(screen.getAllByText('File application').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Applied').length).toBeGreaterThan(0);
    expect(screen.getByText('src/ui/workspace/activity-history-panel.tsx')).toBeInTheDocument();
    expect(screen.getByText('src/ui/workspace/workspace.module.css')).toBeInTheDocument();
  });

  it('renders apply failed state', () => {
    render(<ActivityHistoryPanel activities={[APPLY_FAILED]} />);
    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0);
    expect(screen.getByText('Error: TARGET_ALREADY_EXISTS')).toBeInTheDocument();
  });

  it('renders verification completed status and stage summary', () => {
    render(<ActivityHistoryPanel activities={[VERIFICATION_COMPLETED]} />);
    expect(screen.getAllByText('Verification').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
    expect(screen.getByText(/Project: Passed/)).toBeInTheDocument();
    expect(screen.getByText(/Test: Passed/)).toBeInTheDocument();
  });

  it('updates the detail view when another activity is selected', () => {
    render(<ActivityHistoryPanel activities={REPRESENTATIVE_ACTIVITIES} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Verification' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: /Task preparation/i }));
    expect(screen.getByRole('heading', { level: 3, name: 'Task preparation' })).toBeInTheDocument();
    expect(
      screen.getByText('src/application/workspace/workspace-runtime.service.ts'),
    ).toBeInTheDocument();
  });

  it('supports keyboard navigation and exposes selected state programmatically', () => {
    render(<ActivityHistoryPanel activities={REPRESENTATIVE_ACTIVITIES} />);
    const listbox = screen.getByRole('listbox', { name: 'Recent workspace activities' });
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(options[0]!, { key: 'ArrowDown' });
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('does not render forbidden or raw fixture markers', () => {
    render(<ActivityHistoryPanel activities={REPRESENTATIVE_ACTIVITIES} />);
    const rendered = document.body.textContent ?? '';
    for (const marker of Object.values(UNSAFE_FIXTURE_MARKERS)) {
      expect(rendered).not.toContain(marker);
    }
    expect(rendered).not.toContain('dangerouslySetInnerHTML');
  });

  it('renders only relative logical paths', () => {
    render(<ActivityHistoryPanel activities={REPRESENTATIVE_ACTIVITIES} />);
    fireEvent.click(screen.getByRole('option', { name: /Task preparation/i }));
    const rendered = document.body.textContent ?? '';
    expect(rendered).toContain('src/ui/workspace/activity-history-panel.tsx');
    expect(rendered).not.toMatch(/D:\\projects2/i);
    expect(rendered).not.toMatch(/\/projects2\//i);
  });
});
