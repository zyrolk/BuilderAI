import { render, screen } from '@testing-library/react';

import HomePage from './page';

describe('HomePage', () => {
  it('renders the dashboard and workspace navigation', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'BuilderAI' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open project workspace/i })).toHaveAttribute(
      'href',
      '/workspace',
    );
    expect(screen.getByRole('heading', { name: /engine pipeline/i })).toBeInTheDocument();
    expect(screen.getByText(/current milestone/i)).toBeInTheDocument();
  });
});
