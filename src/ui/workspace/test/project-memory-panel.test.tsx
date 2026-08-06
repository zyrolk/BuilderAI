import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProjectMemoryPanel } from '../project-memory-panel';

describe('ProjectMemoryPanel', () => {
  it('renders saved investigation memory entries', () => {
    render(
      <ProjectMemoryPanel
        memory={{
          schemaVersion: 1,
          projectId: 'zyro-style-fixture',
          updatedAt: '2026-08-05T12:00:00.000Z',
          decisions: [],
          completedWork: [],
          investigations: [
            {
              id: 'inv-1',
              category: 'INVESTIGATION',
              createdAt: '2026-08-05T12:00:00.000Z',
              updatedAt: '2026-08-05T12:00:00.000Z',
              summary: 'Supplier Hub cancellation depends on shared validation.',
              supportingPaths: ['server/services/order-cancellation.service.ts'],
              source: 'INVESTIGATION_SAVE',
              investigationId: 'inv-1',
              confidence: 'MEDIUM',
              affectedAreas: ['server/services/order-cancellation.service.ts'],
            },
          ],
          findings: [],
        }}
      />,
    );

    expect(screen.getByText('Project Memory')).toBeInTheDocument();
    expect(screen.getByText(/Supplier Hub cancellation/)).toBeInTheDocument();
    expect(screen.getByText(/server\/services\/order-cancellation.service.ts/)).toBeInTheDocument();
  });

  it('renders loading, error, and empty states', () => {
    const { rerender } = render(<ProjectMemoryPanel loading />);
    expect(screen.getByText(/Loading durable project memory/)).toBeInTheDocument();

    rerender(<ProjectMemoryPanel error="Memory unavailable." />);
    expect(screen.getByText('Memory unavailable.')).toBeInTheDocument();

    rerender(
      <ProjectMemoryPanel
        memory={{
          schemaVersion: 1,
          projectId: 'zyro-style-fixture',
          updatedAt: '2026-08-05T12:00:00.000Z',
          decisions: [],
          completedWork: [],
          investigations: [],
          findings: [],
        }}
      />,
    );
    expect(screen.getByText(/No durable project memory has been saved yet/)).toBeInTheDocument();
  });
});
