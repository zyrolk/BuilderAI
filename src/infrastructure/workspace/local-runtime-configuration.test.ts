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
    // P1-10: the default preparation review window is 60 minutes, not the prior 15.
    expect(configuration.workspace.preparationTtlMs).toBe(3_600_000);
    expect(configuration.extraSourceScanRoots).toEqual([]);
  });

  it('parses BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS for unusual layouts', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test-secret');
    vi.stubEnv('OPENAI_MODEL', 'configured-model');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());
    vi.stubEnv('BUILDERAI_EXTRA_SOURCE_SCAN_ROOTS', 'features, ./features');

    expect(loadLocalWorkspaceRuntimeConfiguration().extraSourceScanRoots).toEqual(['features']);
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
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('openrouter');

    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash');
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('GEMINI_API_KEY');

    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openrouter');
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-test-secret');
    vi.stubEnv('OPENROUTER_MODEL', '');
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('OPENROUTER_MODEL');

    vi.stubEnv('OPENROUTER_MODEL', 'test/openrouter-model');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('OPENROUTER_API_KEY');
  });

  it('selects OpenRouter using configuration alone and does not require OpenAI or Gemini settings', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openrouter');
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-test-secret');
    vi.stubEnv('OPENROUTER_MODEL', 'test/openrouter-model');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_MODEL', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GEMINI_MODEL', '');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());

    expect(loadLocalWorkspaceRuntimeConfiguration().provider).toMatchObject({
      kind: 'openrouter',
      apiKey: 'openrouter-test-secret',
      baseUrl: 'https://openrouter.ai/api/v1',
      settings: { model: 'test/openrouter-model' },
    });
  });

  it('accepts a custom OpenRouter base URL and optional attribution headers', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openrouter');
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-test-secret');
    vi.stubEnv('OPENROUTER_MODEL', 'test/openrouter-model');
    vi.stubEnv('OPENROUTER_BASE_URL', 'https://proxy.example/openrouter/v1');
    vi.stubEnv('OPENROUTER_HTTP_REFERER', 'https://builderai.local');
    vi.stubEnv('OPENROUTER_APP_TITLE', 'BuilderAI');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());

    expect(loadLocalWorkspaceRuntimeConfiguration().provider).toMatchObject({
      kind: 'openrouter',
      baseUrl: 'https://proxy.example/openrouter/v1',
      httpReferer: 'https://builderai.local',
      appTitle: 'BuilderAI',
    });
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

  it('fails fast at composition time when the provider input-character budget is configured too low', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test-secret');
    vi.stubEnv('OPENAI_MODEL', 'configured-model');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());
    vi.stubEnv('BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS', '10000');

    expect(isLocalWorkspaceRuntimeConfigured()).toBe(false);
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow(
      'BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS',
    );
  });

  it('keeps the preparation TTL supported range unchanged at 60,000-3,600,000 ms (P1-10)', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', 'test-secret');
    vi.stubEnv('OPENAI_MODEL', 'configured-model');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());

    vi.stubEnv('BUILDERAI_PREPARATION_TTL_MS', '59999');
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('BUILDERAI_PREPARATION_TTL_MS');

    vi.stubEnv('BUILDERAI_PREPARATION_TTL_MS', '3600001');
    expect(() => loadLocalWorkspaceRuntimeConfiguration()).toThrow('BUILDERAI_PREPARATION_TTL_MS');

    vi.stubEnv('BUILDERAI_PREPARATION_TTL_MS', '60000');
    expect(loadLocalWorkspaceRuntimeConfiguration().workspace.preparationTtlMs).toBe(60_000);

    vi.stubEnv('BUILDERAI_PREPARATION_TTL_MS', '3600000');
    expect(loadLocalWorkspaceRuntimeConfiguration().workspace.preparationTtlMs).toBe(3_600_000);
  });

  it('accepts a provider input-character budget with sufficient reserved headroom', () => {
    vi.stubEnv('BUILDERAI_LIVE_WORKFLOW_ENABLED', 'true');
    vi.stubEnv('BUILDERAI_AI_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'gemini-test-secret');
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.5-flash');
    vi.stubEnv('BUILDERAI_PROJECT_ROOT', process.cwd());
    vi.stubEnv('BUILDERAI_PROVIDER_MAX_INPUT_CHARACTERS', '150000');

    expect(loadLocalWorkspaceRuntimeConfiguration().provider.settings.maximumInputCharacters).toBe(
      150_000,
    );
  });
});
