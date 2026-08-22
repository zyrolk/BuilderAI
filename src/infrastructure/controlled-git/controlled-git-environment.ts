import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export class ControlledGitPolicyViolationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ControlledGitPolicyViolationError';
  }
}

/**
 * Global option escapes that relocate Git identity or inject config.
 * Note: `git rev-parse --git-dir` is a safe *output selector*, not a relocating global —
 * that case is allowlisted in assertSafeControlledGitArguments.
 */
const FORBIDDEN_GLOBAL_OPTION_EXACT = new Set([
  '-c',
  '--config',
  '--exec-path',
  '--namespace',
  '--super-prefix',
  '--upload-pack',
  '--receive-pack',
  '-C',
]);

const ALLOWED_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'add',
  'commit',
  'rev-parse',
  'branch',
  'ls-files',
]);

const FORBIDDEN_ENV_KEY_FRAGMENTS = [
  'API_KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'CREDENTIAL',
  'PRIVATE_KEY',
] as const;

const ALLOWED_ENV_KEYS = new Set([
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_ENV',
  'CI',
]);

const ALLOWED_GIT_ENV = new Set([
  'GIT_TERMINAL_PROMPT',
  'GIT_OPTIONAL_LOCKS',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_CONFIG_VALUE_0',
]);

export function assertControlledGitRepositoryRoot(
  repositoryRoot: string,
  builderAiRoot?: string,
): string {
  const resolved = path.resolve(repositoryRoot);
  if (resolved.split(/[\\/]/).some((segment) => segment === '..')) {
    throw new ControlledGitPolicyViolationError(
      'REPOSITORY_TRAVERSAL',
      'Repository root contains traversal segments.',
    );
  }
  if (builderAiRoot !== undefined) {
    const builderRoot = path.resolve(builderAiRoot);
    if (pathsEqual(resolved, builderRoot) || isPathWithin(resolved, builderRoot)) {
      throw new ControlledGitPolicyViolationError(
        'BUILDERAI_ROOT_FORBIDDEN',
        'Controlled Git cannot run against the BuilderAI repository root.',
      );
    }
  }
  return resolved;
}

export function assertSafeControlledGitArguments(
  commandId: string,
  fixedArguments: readonly string[],
  repositoryRoot: string,
): void {
  if (fixedArguments.length === 0) {
    throw new ControlledGitPolicyViolationError(
      'EMPTY_GIT_ARGUMENTS',
      'Controlled Git descriptors must include a subcommand.',
    );
  }

  const subcommand = fixedArguments[0];
  if (subcommand === undefined || !ALLOWED_SUBCOMMANDS.has(subcommand)) {
    throw new ControlledGitPolicyViolationError(
      'FORBIDDEN_GIT_SUBCOMMAND',
      `Git subcommand "${subcommand ?? ''}" is not allowlisted.`,
    );
  }

  for (let index = 0; index < fixedArguments.length; index += 1) {
    const argument = fixedArguments[index]!;
    if (argument.includes('\0')) {
      throw new ControlledGitPolicyViolationError(
        'FORBIDDEN_NULL_BYTE',
        'Null bytes are forbidden in Git arguments.',
      );
    }
    if (FORBIDDEN_GLOBAL_OPTION_EXACT.has(argument)) {
      throw new ControlledGitPolicyViolationError(
        'FORBIDDEN_GIT_ARGUMENT',
        `Forbidden Git argument "${argument}" is not allowed.`,
      );
    }
    if (
      argument.startsWith('--git-dir=') ||
      argument.startsWith('--work-tree=') ||
      argument.startsWith('--exec-path=') ||
      argument.startsWith('--namespace=') ||
      argument.startsWith('--super-prefix=') ||
      argument.startsWith('--upload-pack=') ||
      argument.startsWith('--receive-pack=')
    ) {
      throw new ControlledGitPolicyViolationError(
        'FORBIDDEN_GIT_ARGUMENT',
        `Forbidden Git argument "${argument}" is not allowed.`,
      );
    }
    const isRevParseGitDirSelector =
      commandId === 'git-rev-parse-git-dir' &&
      subcommand === 'rev-parse' &&
      index === 1 &&
      (argument === '--git-dir' || argument === '--absolute-git-dir');
    if ((argument === '--git-dir' || argument === '--work-tree') && !isRevParseGitDirSelector) {
      throw new ControlledGitPolicyViolationError(
        'FORBIDDEN_GIT_ARGUMENT',
        `Forbidden Git argument "${argument}" is not allowed.`,
      );
    }
  }

  if (commandId === 'git-add-paths') {
    const separatorIndex = fixedArguments.indexOf('--');
    if (separatorIndex < 0) {
      throw new ControlledGitPolicyViolationError(
        'INVALID_ADD_DESCRIPTOR',
        'git add descriptors must use -- pathspec separator.',
      );
    }
    const paths = fixedArguments.slice(separatorIndex + 1);
    if (paths.length === 0) {
      throw new ControlledGitPolicyViolationError(
        'EMPTY_PATHSPEC',
        'git add requires at least one path.',
      );
    }
    for (const logicalPath of paths) {
      assertSafeRelativePath(logicalPath, repositoryRoot);
    }
  }

  if (commandId === 'git-commit-message-file') {
    const fileFlag = fixedArguments.indexOf('-F');
    const messagePath = fixedArguments[fileFlag + 1];
    if (fileFlag < 0 || messagePath === undefined || !path.isAbsolute(messagePath)) {
      throw new ControlledGitPolicyViolationError(
        'INVALID_COMMIT_MESSAGE_FILE',
        'Commit message file must be an absolute server-owned path.',
      );
    }
  }
}

export function assertSafeRelativePath(logicalPath: string, repositoryRoot: string): void {
  const trimmed = logicalPath.trim().replace(/\\/g, '/');
  if (
    trimmed.length === 0 ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('\0') ||
    trimmed.startsWith('/') ||
    trimmed.includes('..') ||
    path.isAbsolute(logicalPath)
  ) {
    throw new ControlledGitPolicyViolationError(
      'UNSAFE_PATHSPEC',
      `Unsafe Git pathspec "${logicalPath}" rejected.`,
    );
  }
  const root = path.resolve(repositoryRoot);
  const absolute = path.resolve(root, trimmed);
  if (absolute !== root && !isPathWithin(absolute, root)) {
    throw new ControlledGitPolicyViolationError(
      'PATH_ESCAPE',
      `Path "${logicalPath}" escapes the repository root.`,
    );
  }
}

export function buildControlledGitEnvironment(input: {
  readonly hooksPath?: string;
  readonly isolatedConfigDir?: string;
}): NodeJS.ProcessEnv {
  const environment = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  } as unknown as NodeJS.ProcessEnv;

  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && value.length > 0) {
      environment[key] = value;
    }
  }

  for (const key of Object.keys(environment)) {
    if (isForbiddenEnvironmentKey(key)) {
      delete environment[key];
    }
  }

  if (input.isolatedConfigDir !== undefined) {
    environment.GIT_CONFIG_GLOBAL = path.join(input.isolatedConfigDir, 'gitconfig');
    environment.GIT_CONFIG_SYSTEM = path.join(input.isolatedConfigDir, 'systemconfig');
    environment.GIT_CONFIG_NOSYSTEM = '1';
  }

  if (input.hooksPath !== undefined) {
    environment.GIT_CONFIG_COUNT = '1';
    environment.GIT_CONFIG_KEY_0 = 'core.hooksPath';
    environment.GIT_CONFIG_VALUE_0 = input.hooksPath;
  }

  return environment;
}

export async function prepareWriteIsolationArtifacts(): Promise<{
  readonly hooksPath: string;
  readonly isolatedConfigDir: string;
}> {
  const isolatedConfigDir = await mkdtemp(path.join(tmpdir(), 'builderai-git-config-'));
  const hooksPath = await mkdtemp(path.join(tmpdir(), 'builderai-git-hooks-'));
  await writeFile(path.join(isolatedConfigDir, 'gitconfig'), '', 'utf8');
  await writeFile(path.join(isolatedConfigDir, 'systemconfig'), '', 'utf8');
  await mkdir(hooksPath, { recursive: true });
  try {
    await access(hooksPath);
  } catch {
    // ignore
  }
  return { hooksPath, isolatedConfigDir };
}

export function isForbiddenEnvironmentKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (upper.startsWith('BUILDERAI_')) return true;
  if (upper.startsWith('GIT_') && !ALLOWED_GIT_ENV.has(upper)) return true;
  return FORBIDDEN_ENV_KEY_FRAGMENTS.some((fragment) => upper.includes(fragment));
}

function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathsEqual(left: string, right: string): boolean {
  return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}
