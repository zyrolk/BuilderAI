import type { ControlledGitCommandDescriptor } from './controlled-git.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 512_000;

export function createGitStatusPorcelainDescriptor(
  overrides: Partial<Pick<ControlledGitCommandDescriptor, 'timeoutMs' | 'outputLimitBytes'>> = {},
): ControlledGitCommandDescriptor {
  return {
    id: 'git-status-porcelain',
    fixedArguments: ['status', '--porcelain=v1', '-uall'],
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    outputLimitBytes: overrides.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
    neutralizeHooks: false,
  };
}

export function createGitDiffStatDescriptor(
  overrides: Partial<Pick<ControlledGitCommandDescriptor, 'timeoutMs' | 'outputLimitBytes'>> = {},
): ControlledGitCommandDescriptor {
  return {
    id: 'git-diff-stat',
    fixedArguments: ['diff', '--stat', '--no-ext-diff', '--no-color'],
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    outputLimitBytes: overrides.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
    neutralizeHooks: false,
  };
}

export function createGitAddPathsDescriptor(
  paths: readonly string[],
  overrides: Partial<Pick<ControlledGitCommandDescriptor, 'timeoutMs' | 'outputLimitBytes'>> = {},
): ControlledGitCommandDescriptor {
  return {
    id: 'git-add-paths',
    fixedArguments: ['add', '--', ...paths],
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    outputLimitBytes: overrides.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
    neutralizeHooks: true,
  };
}

export function createGitCommitMessageFileDescriptor(
  messageFileAbsolutePath: string,
  overrides: Partial<Pick<ControlledGitCommandDescriptor, 'timeoutMs' | 'outputLimitBytes'>> = {},
): ControlledGitCommandDescriptor {
  return {
    id: 'git-commit-message-file',
    fixedArguments: ['commit', '--no-edit', '-F', messageFileAbsolutePath],
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    outputLimitBytes: overrides.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
    neutralizeHooks: true,
  };
}

export function createGitRevParseHeadDescriptor(): ControlledGitCommandDescriptor {
  return {
    id: 'git-rev-parse-head',
    fixedArguments: ['rev-parse', 'HEAD'],
    timeoutMs: 5_000,
    outputLimitBytes: 4_096,
    neutralizeHooks: false,
  };
}

export function createGitBranchShowCurrentDescriptor(): ControlledGitCommandDescriptor {
  return {
    id: 'git-branch-show-current',
    fixedArguments: ['branch', '--show-current'],
    timeoutMs: 5_000,
    outputLimitBytes: 4_096,
    neutralizeHooks: false,
  };
}

export function createGitRevParseGitDirDescriptor(): ControlledGitCommandDescriptor {
  return {
    id: 'git-rev-parse-git-dir',
    fixedArguments: ['rev-parse', '--git-dir'],
    timeoutMs: 5_000,
    outputLimitBytes: 4_096,
    neutralizeHooks: false,
  };
}

export function createGitIsInsideWorkTreeDescriptor(): ControlledGitCommandDescriptor {
  return {
    id: 'git-rev-parse-is-inside-work-tree',
    fixedArguments: ['rev-parse', '--is-inside-work-tree'],
    timeoutMs: 5_000,
    outputLimitBytes: 4_096,
    neutralizeHooks: false,
  };
}

export function createGitDiffCachedNameOnlyDescriptor(): ControlledGitCommandDescriptor {
  return {
    id: 'git-diff-cached-name-only',
    fixedArguments: ['diff', '--cached', '--name-only', '--no-ext-diff'],
    timeoutMs: 15_000,
    outputLimitBytes: 256_000,
    neutralizeHooks: false,
  };
}

export function createGitDiffNameOnlyDescriptor(): ControlledGitCommandDescriptor {
  return {
    id: 'git-diff-name-only',
    fixedArguments: ['diff', '--name-only', '--no-ext-diff'],
    timeoutMs: 15_000,
    outputLimitBytes: 256_000,
    neutralizeHooks: false,
  };
}

export function createGitLsFilesUnmergedDescriptor(): ControlledGitCommandDescriptor {
  return {
    id: 'git-ls-files-unmerged',
    fixedArguments: ['ls-files', '--unmerged'],
    timeoutMs: 10_000,
    outputLimitBytes: 64_000,
    neutralizeHooks: false,
  };
}
