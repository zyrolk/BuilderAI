import { render, screen } from '@testing-library/react';

import { ZYRO_STYLE_FIXTURE_ROOT } from '../../core/target-project/test/external-target.fixture';
import WorkspacePage from './page';

describe('WorkspacePage', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('loads canonical project information when the live runtime is disabled', async () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'false');
    render(await WorkspacePage());

    expect(screen.getByRole('heading', { level: 1, name: 'BuilderAI' })).toBeInTheDocument();
    expect(screen.getByText('Core boundaries validated')).toBeInTheDocument();
    expect(screen.getByText('Interface review mode')).toBeInTheDocument();
  });

  it('loads external-target project information when the live runtime is enabled', async () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test-secret');
    vi.stubEnv('OPENAI_MODEL', 'configured-model');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', ZYRO_STYLE_FIXTURE_ROOT);
    vi.stubEnv('BUILDERAI_WORKSPACE_PROJECT_PROFILE', 'external-target');

    render(await WorkspacePage());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Zyro Style Fixture' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('zyro-style-fixture').length).toBeGreaterThan(0);
    expect(screen.getByText('External target connected')).toBeInTheDocument();
    expect(screen.getByText('Connected project')).toBeInTheDocument();
  });
});
