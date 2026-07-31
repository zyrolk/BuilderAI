import {
  isLocalWorkspaceRuntimeConfigured,
  loadLocalWorkspaceRuntimeConfiguration,
} from './local-runtime-configuration';

describe('local workspace runtime configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is fail-closed until every explicit server-only setting is present', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'false');
    expect(isLocalWorkspaceRuntimeConfigured()).toBe(false);
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('disabled');
  });

  it('loads bounded settings without exposing secrets to the UI status', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test-secret');
    vi.stubEnv('OPENAI_MODEL', 'configured-model');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());

    const configuration = loadLocalWorkspaceRuntimeConfiguration();

    expect(isLocalWorkspaceRuntimeConfigured()).toBe(true);
    expect(configuration.projectRoot).toBe(process.cwd());
    expect(configuration.provider).toMatchObject({
      kind: 'openai',
      apiKey: 'test-secret',
      settings: { model: 'configured-model' },
    });
  });

  it('selects Gemini using configuration alone and does not require OpenAI settings', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-secret');
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_MODEL', '');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());

    expect(loadLocalWorkspaceRuntimeConfiguration().provider).toMatchObject({
      kind: 'gemini',
      apiKey: 'gemini-test-secret',
      settings: { model: 'gemini-3.5-flash' },
    });
  });

  it('rejects unsupported provider selections and missing selected-provider credentials', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'other');
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('openai');

    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash');
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('GEMINI_API_KEY');
  });

  it('rejects values outside supported bounds', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test-secret');
    vi.stubEnv('OPENAI_MODEL', 'configured-model');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());
    vi.stubEnv('BUILDERAI_MAX_PREPARATIONS', '0');

    expect(isLocalWorkspaceRuntimeConfigured()).toBe(false);
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('outside');
  });
});
