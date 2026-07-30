import { render, screen } from '@testing-library/react';

import HomePage from './page';

describe('HomePage', () => {
  it('identifies the project foundation', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'BuilderAI' })).toBeInTheDocument();
    expect(screen.getByText(/engineering baseline is ready/i)).toBeInTheDocument();
  });
});
