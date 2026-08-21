/** Environment variable names that must never reach target verification scripts. */
export const VERIFICATION_FORBIDDEN_ENVIRONMENT_KEYS = [
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_HTTP_REFERER',
  'OPENROUTER_APP_TITLE',
  'BUILDERAI_WORKSPACE_ACCESS_TOKEN',
  'BUILDERAI_WORKSPACE_CSRF_TOKEN',
  'FIREBASE_API_KEY',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'DATABASE_URL',
  'DB_PASSWORD',
  'npm_config_cache',
  'npm_execpath',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES',
] as const;

/** Safe runtime variables required for npm/node on the host OS. */
export const VERIFICATION_ALLOWED_ENVIRONMENT_KEYS = [
  'APPDATA',
  'CI',
  'ComSpec',
  'HOME',
  'LOCALAPPDATA',
  'NODE_ENV',
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
] as const;

export function buildAllowlistedVerificationEnvironment(
  hostEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowlisted: Record<string, string> = {};
  allowlisted.NODE_ENV = hostEnvironment.NODE_ENV ?? 'production';
  for (const key of VERIFICATION_ALLOWED_ENVIRONMENT_KEYS) {
    const value = hostEnvironment[key];
    if (value !== undefined && value.length > 0) {
      allowlisted[key] = value;
    }
  }
  return allowlisted as NodeJS.ProcessEnv;
}

export function containsForbiddenVerificationEnvironmentKey(
  environment: NodeJS.ProcessEnv,
): string | undefined {
  for (const key of Object.keys(environment)) {
    const normalized = key.toUpperCase();
    if (
      VERIFICATION_FORBIDDEN_ENVIRONMENT_KEYS.some(
        (forbidden) => forbidden.toUpperCase() === normalized,
      )
    ) {
      return key;
    }
    if (
      normalized.includes('API_KEY') ||
      normalized.includes('SECRET') ||
      normalized.includes('TOKEN')
    ) {
      return key;
    }
    if (normalized.startsWith('BUILDERAI_')) {
      return key;
    }
  }
  return undefined;
}
