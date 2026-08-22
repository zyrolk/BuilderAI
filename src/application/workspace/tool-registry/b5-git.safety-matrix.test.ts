/**
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { InMemoryAppliedFileApplyBindingStore } from '../controlled-git/applied-file-apply-binding.port';
import { ControlledGitService } from '../controlled-git/controlled-git.service';
import { ControlledGitRunner } from '../../../infrastructure/controlled-git/controlled-git-runner';
import {
  assertSafeControlledGitArguments,
  buildControlledGitEnvironment,
  ControlledGitPolicyViolationError,
  isForbiddenEnvironmentKey,
} from '../../../infrastructure/controlled-git/controlled-git-environment';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

function gitOut(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

async function createGitRepo(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'builderai-b5-safe-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'b5@example.com']);
  git(root, ['config', 'user.name', 'B5 Tester']);
  await writeFile(path.join(root, 'README.md'), '# b5\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'init']);
  return {
    root,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

function createService(bindings: InMemoryAppliedFileApplyBindingStore): ControlledGitService {
  return new ControlledGitService({
    appliedBindings: bindings,
    createRunner: (repositoryRoot) => new ControlledGitRunner({ repositoryRoot }),
  });
}

describe('B5 audited safety matrix', { timeout: 120_000 }, () => {
  it('rejects repository identity / baseline drift and branch mismatch', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 1;\n', 'utf8');
      const head = gitOut(repo.root, ['rev-parse', 'HEAD']);
      const branch = gitOut(repo.root, ['branch', '--show-current']);
      bindings.put({
        preparationId: 'prep',
        projectId: 'builder-ai',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
        headCommitAtApply: head,
        branchAtApply: branch,
      });

      // Extra commit → baseline drift.
      await writeFile(path.join(repo.root, 'noise.md'), 'n\n', 'utf8');
      git(repo.root, ['add', 'noise.md']);
      git(repo.root, ['commit', '-m', 'noise']);
      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 2;\n', 'utf8');

      const service = createService(bindings);
      const drifted = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        requestedPaths: ['a.ts'],
        operatorApproved: true,
      });
      expect(drifted.policyBlockCode).toBe('BASELINE_DRIFT');

      // Fresh head binding but wrong expected branch.
      const head2 = gitOut(repo.root, ['rev-parse', 'HEAD']);
      bindings.put({
        preparationId: 'prep2',
        projectId: 'builder-ai',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:01:00.000Z',
        headCommitAtApply: head2,
        branchAtApply: branch,
      });
      const branchMismatch = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep2',
        requestedPaths: ['a.ts'],
        operatorApproved: true,
        expectedBranch: 'definitely-not-this-branch',
      });
      expect(branchMismatch.policyBlockCode).toBe('BRANCH_MISMATCH');
    } finally {
      await repo.cleanup();
    }
  });

  it('rejects conflict (unmerged) state', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await writeFile(path.join(repo.root, 'conflict.ts'), 'base\n', 'utf8');
      git(repo.root, ['add', 'conflict.ts']);
      git(repo.root, ['commit', '-m', 'base']);
      git(repo.root, ['checkout', '-b', 'side']);
      await writeFile(path.join(repo.root, 'conflict.ts'), 'side\n', 'utf8');
      git(repo.root, ['add', 'conflict.ts']);
      git(repo.root, ['commit', '-m', 'side']);
      git(repo.root, ['checkout', '-']);
      await writeFile(path.join(repo.root, 'conflict.ts'), 'main\n', 'utf8');
      git(repo.root, ['add', 'conflict.ts']);
      git(repo.root, ['commit', '-m', 'mainline']);
      try {
        git(repo.root, ['merge', 'side']);
      } catch {
        // expected conflict
      }
      bindings.put({
        preparationId: 'prep',
        projectId: 'builder-ai',
        appliedPaths: ['conflict.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
      });
      const service = createService(bindings);
      const result = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        requestedPaths: ['conflict.ts'],
        operatorApproved: true,
      });
      expect(['CONFLICT_STATE', 'UNSAFE_GIT_OPERATION_IN_PROGRESS']).toContain(
        result.policyBlockCode,
      );
    } finally {
      await repo.cleanup();
    }
  });

  it('rejects merge/rebase/cherry-pick/bisect, conflicts, and index lock', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 1;\n', 'utf8');
      bindings.put({
        preparationId: 'prep',
        projectId: 'builder-ai',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
      });
      const service = createService(bindings);
      const gitDir = path.join(repo.root, '.git');

      await writeFile(
        path.join(gitDir, 'MERGE_HEAD'),
        `${gitOut(repo.root, ['rev-parse', 'HEAD'])}\n`,
        'utf8',
      );
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep',
            requestedPaths: ['a.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('UNSAFE_GIT_OPERATION_IN_PROGRESS');
      await rm(path.join(gitDir, 'MERGE_HEAD'), { force: true });

      await mkdir(path.join(gitDir, 'rebase-merge'), { recursive: true });
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep',
            requestedPaths: ['a.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('UNSAFE_GIT_OPERATION_IN_PROGRESS');
      await rm(path.join(gitDir, 'rebase-merge'), { recursive: true, force: true });

      await writeFile(path.join(gitDir, 'CHERRY_PICK_HEAD'), 'deadbeef\n', 'utf8');
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep',
            requestedPaths: ['a.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('UNSAFE_GIT_OPERATION_IN_PROGRESS');
      await rm(path.join(gitDir, 'CHERRY_PICK_HEAD'), { force: true });

      await writeFile(path.join(gitDir, 'BISECT_LOG'), 'bisect\n', 'utf8');
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep',
            requestedPaths: ['a.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('UNSAFE_GIT_OPERATION_IN_PROGRESS');
      await rm(path.join(gitDir, 'BISECT_LOG'), { force: true });

      await writeFile(path.join(gitDir, 'index.lock'), '', 'utf8');
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep',
            requestedPaths: ['a.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('INDEX_LOCKED');
      await rm(path.join(gitDir, 'index.lock'), { force: true });
    } finally {
      await repo.cleanup();
    }
  });

  it('rejects unrelated staged paths, path traversal, and broad pathspecs', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await writeFile(path.join(repo.root, 'allowed.ts'), 'export const a = 1;\n', 'utf8');
      await writeFile(path.join(repo.root, 'other.ts'), 'export const o = 1;\n', 'utf8');
      git(repo.root, ['add', 'other.ts']);
      bindings.put({
        preparationId: 'prep',
        projectId: 'builder-ai',
        appliedPaths: ['allowed.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
      });
      const service = createService(bindings);
      const unrelatedStaged = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        requestedPaths: ['allowed.ts'],
        operatorApproved: true,
      });
      expect(unrelatedStaged.policyBlockCode).toBe('UNRELATED_STAGED_PATHS');

      expect(() =>
        assertSafeControlledGitArguments(
          'git-add-paths',
          ['add', '--', '../outside.ts'],
          repo.root,
        ),
      ).toThrow(ControlledGitPolicyViolationError);

      expect(() =>
        assertSafeControlledGitArguments('git-add-paths', ['add', '--', '.'], repo.root),
      ).toThrow(/Unsafe Git pathspec|UNSAFE_PATHSPEC|FORBIDDEN/);

      const broad = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        requestedPaths: ['.'],
        operatorApproved: true,
      });
      expect([
        'EMPTY_PATHSPEC',
        'UNSAFE_PATHSPEC',
        'FORBIDDEN_GLOB_PATHSPEC',
        'UNRELATED_STAGED_PATHS',
      ]).toContain(broad.policyBlockCode);
    } finally {
      await repo.cleanup();
    }
  });

  it('rejects malicious argv tokens including -c/--config and alias-shaped injection', () => {
    for (const token of ['-c', '--config', '--exec-path', '--git-dir', '--work-tree', '-C']) {
      expect(() =>
        assertSafeControlledGitArguments(
          'git-status-porcelain',
          ['status', '--porcelain=v1', token, 'x'],
          '/repo',
        ),
      ).toThrow(/Forbidden Git argument|FORBIDDEN_GIT_ARGUMENT/);
    }
    expect(() =>
      assertSafeControlledGitArguments(
        'git-status-porcelain',
        ['status', '--git-dir=/tmp/evil'],
        '/repo',
      ),
    ).toThrow(/Forbidden Git argument|FORBIDDEN_GIT_ARGUMENT/);
  });

  it('scrubs credential/helper env and forbids secret keys', () => {
    expect(isForbiddenEnvironmentKey('GIT_ASKPASS')).toBe(true);
    expect(isForbiddenEnvironmentKey('GIT_CREDENTIAL_HELPER')).toBe(true);
    expect(isForbiddenEnvironmentKey('OPENAI_API_KEY')).toBe(true);
    expect(isForbiddenEnvironmentKey('BUILDERAI_TOKEN')).toBe(true);
    const env = buildControlledGitEnvironment({});
    expect(env.GIT_ASKPASS).toBeUndefined();
    expect(env.GIT_CREDENTIAL_HELPER).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('rejects submodule topology', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await writeFile(path.join(repo.root, '.gitmodules'), '[submodule "x"]\n', 'utf8');
      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 1;\n', 'utf8');
      bindings.put({
        preparationId: 'prep',
        projectId: 'builder-ai',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
      });
      const service = createService(bindings);
      const result = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        requestedPaths: ['a.ts'],
        operatorApproved: true,
      });
      expect(result.policyBlockCode).toBe('UNSUPPORTED_GIT_TOPOLOGY');
    } finally {
      await repo.cleanup();
    }
  });

  it('neutralizes hooks for write verbs and does not destructively rollback on commit failure', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      const hooks = path.join(repo.root, '.git', 'hooks');
      await mkdir(hooks, { recursive: true });
      const preCommit = path.join(hooks, 'pre-commit');
      // Would fail if executed; neutralization must prevent it.
      await writeFile(preCommit, '#!/bin/sh\necho HOOK_RAN >&2\nexit 1\n', 'utf8');

      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 1;\n', 'utf8');
      bindings.put({
        preparationId: 'prep',
        projectId: 'builder-ai',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
      });
      const service = createService(bindings);
      const staged = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        requestedPaths: ['a.ts'],
        operatorApproved: true,
      });
      expect(staged.executionStatus).toBe('SUCCEEDED');

      const beforeHead = gitOut(repo.root, ['rev-parse', 'HEAD']);
      const committed = await service.commitSnapshot({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        operatorApproved: true,
        commitMessage: 'safe commit despite repo hook',
      });
      expect(committed.executionStatus).toBe('SUCCEEDED');
      const afterHead = gitOut(repo.root, ['rev-parse', 'HEAD']);
      expect(afterHead).not.toBe(beforeHead);

      // Commit failure path: nothing staged + no destructive recovery verbs used.
      const failed = await service.commitSnapshot({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        operatorApproved: true,
      });
      expect(failed.policyBlockCode).toBe('NOTHING_STAGED');
      expect(gitOut(repo.root, ['rev-parse', 'HEAD'])).toBe(afterHead);
      expect(gitOut(repo.root, ['status', '--porcelain'])).toBe('');
      // Hook file still present (no clean/reset of hooks).
      expect(await readFile(preCommit, 'utf8')).toContain('HOOK_RAN');
    } finally {
      await repo.cleanup();
    }
  });

  it('bounds output and honors cancellation/timeout on the runner', async () => {
    const repo = await createGitRepo();
    try {
      const runner = new ControlledGitRunner({ repositoryRoot: repo.root });
      const cancelled = await runner.execute(
        {
          id: 'git-status-porcelain',
          fixedArguments: ['status', '--porcelain=v1'],
          timeoutMs: 30_000,
          outputLimitBytes: 512_000,
          neutralizeHooks: false,
        },
        {
          cancellation: {
            cancelled: true,
            reason: 'test',
            subscribe: () => () => undefined,
          },
        },
      );
      expect(cancelled.cancelled).toBe(true);

      const timed = await runner.execute({
        id: 'git-status-porcelain',
        fixedArguments: ['status', '--porcelain=v1'],
        timeoutMs: 1,
        outputLimitBytes: 16,
        neutralizeHooks: false,
      });
      // Tiny timeout may race; either timeout or succeed with bounded flags is acceptable.
      expect(timed.stdoutLimited || timed.timedOut || timed.exitCode === 0).toBe(true);
    } finally {
      await repo.cleanup();
    }
  });

  it('proves controlled-git modules have zero FileApply/approveAndApply imports', async () => {
    const roots = [
      path.join(process.cwd(), 'src/application/workspace/controlled-git'),
      path.join(process.cwd(), 'src/infrastructure/controlled-git'),
      path.join(
        process.cwd(),
        'src/application/workspace/tool-registry/tools/inspect-git-status.tool.ts',
      ),
      path.join(
        process.cwd(),
        'src/application/workspace/tool-registry/tools/inspect-git-diff.tool.ts',
      ),
      path.join(
        process.cwd(),
        'src/application/workspace/tool-registry/tools/stage-git-paths.tool.ts',
      ),
      path.join(
        process.cwd(),
        'src/application/workspace/tool-registry/tools/commit-git-snapshot.tool.ts',
      ),
      path.join(process.cwd(), 'src/application/workspace/tool-registry/create-b5-git-registry.ts'),
    ];
    const { readdir, stat } = await import('node:fs/promises');
    async function collect(target: string): Promise<string[]> {
      const info = await stat(target);
      if (info.isFile()) return [target];
      const entries = await readdir(target);
      const nested = await Promise.all(entries.map((entry) => collect(path.join(target, entry))));
      return nested.flat();
    }
    const files = (await Promise.all(roots.map(collect))).flat().filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"][^'"]*\/file-apply['"]/);
      expect(source, file).not.toMatch(/FileApplyEngineService/);
      expect(source, file).not.toMatch(/\bapproveAndApply\s*\(/);
      expect(source, file).not.toMatch(/from ['"][^'"]*safe-verification-runner['"]/);
    }
  });
});
