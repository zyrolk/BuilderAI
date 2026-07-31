import { render, screen } from '@testing-library/react';

import WorkspacePage from './page';

describe('WorkspacePage', () => {
  it('loads canonical project information into the safe workspace screen', () => {
    render(<WorkspacePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'BuilderAI' })).toBeInTheDocument();
    expect(screen.getByText('Core boundaries validated')).toBeInTheDocument();
    expect(screen.getByText('Interface review mode')).toBeInTheDocument();
  });
});
