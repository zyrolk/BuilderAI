import { access } from 'node:fs/promises';
import path from 'node:path';

import type {
  ControlledGitRunner,
  ControlledGitExecutionResult,
} from '../../../infrastructure/controlled-git/controlled-git-runner';
import {
  createGitBranchShowCurrentDescriptor,
  createGitDiffCachedNameOnlyDescriptor,
  createGitDiffNameOnlyDescriptor,
  createGitDiffStatDescriptor,
  createGitIsInsideWorkTreeDescriptor,
  createGitLsFilesUnmergedDescriptor,
  createGitRevParseGitDirDescriptor,
  createGitRevParseHeadDescriptor,
  createGitStatusPorcelainDescriptor,
} from './controlled-git-descriptors';
import type { GitRepositorySafetySnapshot } from './controlled-git.types';

export async function captureGitRepositorySafetySnapshot(
  runner: ControlledGitRunner,
  repositoryRoot: string,
): Promise<
  | { readonly ok: true; readonly snapshot: GitRepositorySafetySnapshot }
  | { readonly ok: false; readonly code: string; readonly message: string }
> {
  const inside = await runner.execute(createGitIsInsideWorkTreeDescriptor());
  if (inside.policyBlocked || inside.cancelled || inside.timedOut || inside.exitCode !== 0) {
    return {
      ok: false,
      code: inside.policyBlockCode ?? 'NOT_A_GIT_WORK_TREE',
      message: 'Repository is not a usable Git work tree.',
    };
  }
  if (inside.stdout.trim() !== 'true') {
    return {
      ok: false,
      code: 'NOT_A_GIT_WORK_TREE',
      message: 'Repository is not a usable Git work tree.',
    };
  }

  const gitDirResult = await runner.execute(createGitRevParseGitDirDescriptor());
  if (gitDirResult.policyBlocked) {
    return {
      ok: false,
      code: gitDirResult.policyBlockCode ?? 'FORBIDDEN_GIT_ARGUMENT',
      message: 'Git directory probe blocked by Controlled Git policy.',
    };
  }
  if (gitDirResult.exitCode !== 0) {
    return { ok: false, code: 'GIT_DIR_UNRESOLVED', message: 'Unable to resolve .git directory.' };
  }
  const gitDirRaw = gitDirResult.stdout.trim();
  const gitDirAbsolute = path.isAbsolute(gitDirRaw)
    ? path.resolve(gitDirRaw)
    : path.resolve(repositoryRoot, gitDirRaw);
  try {
    const { stat } = await import('node:fs/promises');
    const entry = await stat(gitDirAbsolute);
    if (!entry.isDirectory()) {
      return {
        ok: false,
        code: 'UNSUPPORTED_GIT_TOPOLOGY',
        message: 'Non-directory .git (worktree/gitfile) is unsupported in B5 MVP.',
      };
    }
  } catch {
    return { ok: false, code: 'GIT_DIR_MISSING', message: 'Git directory is missing.' };
  }

  const branchResult = await runner.execute(createGitBranchShowCurrentDescriptor());
  const branch = branchResult.stdout.trim();
  const detachedHead = branch.length === 0;
  const headResult = await runner.execute(createGitRevParseHeadDescriptor());
  const headCommit =
    headResult.exitCode === 0 && headResult.stdout.trim().length > 0
      ? headResult.stdout.trim()
      : undefined;

  const status = await runner.execute(createGitStatusPorcelainDescriptor());
  const dirtyPaths = parsePorcelainPaths(status.stdout);

  const staged = await runner.execute(createGitDiffCachedNameOnlyDescriptor());
  const stagedPaths = splitLines(staged.stdout);

  const unstaged = await runner.execute(createGitDiffNameOnlyDescriptor());
  const unstagedPaths = splitLines(unstaged.stdout);

  const unmerged = await runner.execute(createGitLsFilesUnmergedDescriptor());
  const unmergedPaths = splitLines(unmerged.stdout);

  const gitDir = gitDirAbsolute;
  const inMerge = await pathExists(path.join(gitDir, 'MERGE_HEAD'));
  const inCherryPick = await pathExists(path.join(gitDir, 'CHERRY_PICK_HEAD'));
  const inBisect = await pathExists(path.join(gitDir, 'BISECT_LOG'));
  const inRebase =
    (await pathExists(path.join(gitDir, 'rebase-merge'))) ||
    (await pathExists(path.join(gitDir, 'rebase-apply')));
  const indexLocked = await pathExists(path.join(gitDir, 'index.lock'));

  if (
    (await pathExists(path.join(repositoryRoot, '.gitmodules'))) ||
    (await pathExists(path.join(gitDir, 'modules')))
  ) {
    return {
      ok: false,
      code: 'UNSUPPORTED_GIT_TOPOLOGY',
      message: 'Submodule topology is unsupported in B5 MVP.',
    };
  }

  const allDirty = uniquePaths([...dirtyPaths, ...unstagedPaths, ...stagedPaths]);

  return {
    ok: true,
    snapshot: {
      repositoryRoot,
      ...(branch.length > 0 ? { branch } : {}),
      ...(headCommit !== undefined ? { headCommit } : {}),
      detachedHead,
      dirtyPaths: allDirty,
      stagedPaths,
      unmergedPaths,
      inMerge,
      inRebase,
      inCherryPick,
      inBisect,
      indexLocked,
      gitDirIsDirectory: true,
      isInsideWorkTree: true,
    },
  };
}

export function assertWritableGitState(
  snapshot: GitRepositorySafetySnapshot,
  allowedPaths: ReadonlySet<string>,
): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (snapshot.detachedHead) {
    return {
      ok: false,
      code: 'DETACHED_HEAD',
      message: 'Detached HEAD is forbidden for Git write.',
    };
  }
  if (snapshot.inMerge || snapshot.inRebase || snapshot.inCherryPick || snapshot.inBisect) {
    return {
      ok: false,
      code: 'UNSAFE_GIT_OPERATION_IN_PROGRESS',
      message: 'Merge/rebase/cherry-pick/bisect state is forbidden for Git write.',
    };
  }
  if (snapshot.unmergedPaths.length > 0) {
    return { ok: false, code: 'CONFLICT_STATE', message: 'Unmerged paths are present.' };
  }
  if (snapshot.indexLocked) {
    return {
      ok: false,
      code: 'INDEX_LOCKED',
      message: 'Git index.lock indicates concurrent operation.',
    };
  }

  const unrelatedStaged = snapshot.stagedPaths.filter((p) => !allowedPaths.has(normalizePath(p)));
  if (unrelatedStaged.length > 0) {
    return {
      ok: false,
      code: 'UNRELATED_STAGED_PATHS',
      message: `Unrelated staged paths present: ${unrelatedStaged.slice(0, 5).join(', ')}`,
    };
  }

  const unrelatedDirty = snapshot.dirtyPaths.filter((p) => !allowedPaths.has(normalizePath(p)));
  if (unrelatedDirty.length > 0) {
    return {
      ok: false,
      code: 'UNRELATED_DIRTY_PATHS',
      message: `Unrelated dirty paths present: ${unrelatedDirty.slice(0, 5).join(', ')}`,
    };
  }

  return { ok: true };
}

export function mapExecution(
  commandId: string,
  execution: ControlledGitExecutionResult,
  digest: (value: unknown) => string,
  summaryMax = 1_024,
): {
  readonly commandId: string;
  readonly executionStatus: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly policyBlocked: boolean;
  readonly policyBlockCode?: string;
  readonly outputDigest: string;
  readonly diagnosticSummary: string;
  readonly outputLimited: boolean;
} {
  const executionStatus = execution.policyBlocked
    ? 'REJECTED_BY_POLICY'
    : execution.cancelled
      ? 'CANCELLED'
      : execution.timedOut
        ? 'TIMEOUT'
        : execution.exitCode === 0
          ? 'SUCCEEDED'
          : 'FAILED';
  const diagnosticSummary = [execution.stdout, execution.stderr]
    .filter((part) => part.length > 0)
    .join('\n---\n')
    .slice(0, summaryMax);
  return {
    commandId,
    executionStatus,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    cancelled: execution.cancelled,
    policyBlocked: execution.policyBlocked,
    ...(execution.policyBlockCode !== undefined
      ? { policyBlockCode: execution.policyBlockCode }
      : {}),
    outputDigest: digest({
      commandId,
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr,
    }),
    diagnosticSummary,
    outputLimited: execution.outputLimited,
  };
}

export function createGitDiffStatResult(
  runner: ControlledGitRunner,
  digest: (value: unknown) => string,
) {
  return runner
    .execute(createGitDiffStatDescriptor())
    .then((execution) => mapExecution('git-diff-stat', execution, digest));
}

function parsePorcelainPaths(stdout: string): string[] {
  return splitLines(stdout)
    .map((line) => {
      if (line.length < 4) return '';
      // porcelain v1: XY<space>path or XY<space>orig -> path
      const body = line.slice(3);
      const renameIndex = body.indexOf(' -> ');
      return normalizePath(renameIndex >= 0 ? body.slice(renameIndex + 4) : body);
    })
    .filter((entry) => entry.length > 0);
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter((line) => line.length > 0);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter((entry) => entry.length > 0))];
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

export { normalizePath };
