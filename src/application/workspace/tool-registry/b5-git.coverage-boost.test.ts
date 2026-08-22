/**
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { InMemoryAppliedFileApplyBindingStore } from '../controlled-git/applied-file-apply-binding.port';
import { createGitDiffStatDescriptor } from '../controlled-git/controlled-git-descriptors';
import { createGitDiffStatResult, mapExecution } from '../controlled-git/controlled-git-safety';
import { ControlledGitService } from '../controlled-git/controlled-git.service';
import {
  CONTROLLED_GIT_COMMAND_IDS,
  CONTROLLED_GIT_EXECUTION_STATUSES,
} from '../controlled-git/controlled-git.types';
import {
  assertSafeControlledGitArguments,
  buildControlledGitEnvironment,
  ControlledGitPolicyViolationError,
  isForbiddenEnvironmentKey,
  prepareWriteIsolationArtifacts,
} from '../../../infrastructure/controlled-git/controlled-git-environment';
import { ControlledGitRunner } from '../../../infrastructure/controlled-git/controlled-git-runner';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

async function createGitRepo(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'builderai-b5-cov-'));
  git(root, ['init']);
  git(root, ['config', 'user.email', 'b5@example.com']);
  git(root, ['config', 'user.name', 'B5 Tester']);
  await writeFile(path.join(root, 'README.md'), '# b5\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-m', 'init']);
  return { root, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

describe('B5 coverage boost', { timeout: 60_000 }, () => {
  it('exports command id / status catalogs', () => {
    expect(CONTROLLED_GIT_COMMAND_IDS).toContain('git-add-paths');
    expect(CONTROLLED_GIT_EXECUTION_STATUSES).toContain('TIMEOUT');
  });

  it('maps cancelled/timeout/failed execution statuses', () => {
    const digest = (value: unknown) => JSON.stringify(value);
    expect(
      mapExecution(
        'x',
        {
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: true,
          policyBlocked: false,
          stdout: '',
          stderr: '',
          stdoutLimited: false,
          stderrLimited: false,
          outputLimited: false,
        },
        digest,
      ).executionStatus,
    ).toBe('CANCELLED');
    expect(
      mapExecution(
        'x',
        {
          exitCode: null,
          signal: 'SIGTERM',
          timedOut: true,
          cancelled: false,
          policyBlocked: false,
          stdout: '',
          stderr: '',
          stdoutLimited: false,
          stderrLimited: false,
          outputLimited: false,
        },
        digest,
      ).executionStatus,
    ).toBe('TIMEOUT');
    expect(
      mapExecution(
        'x',
        {
          exitCode: 1,
          signal: null,
          timedOut: false,
          cancelled: false,
          policyBlocked: false,
          stdout: 'out',
          stderr: 'err',
          stdoutLimited: true,
          stderrLimited: false,
          outputLimited: true,
        },
        digest,
      ).executionStatus,
    ).toBe('FAILED');
    expect(
      mapExecution(
        'x',
        {
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          policyBlocked: true,
          policyBlockCode: 'FORBIDDEN_GIT_ARGUMENT',
          stdout: '',
          stderr: '',
          stdoutLimited: false,
          stderrLimited: false,
          outputLimited: false,
        },
        digest,
      ).policyBlockCode,
    ).toBe('FORBIDDEN_GIT_ARGUMENT');
  });

  it('rejects empty argv, unknown subcommands, and commit message file shape', () => {
    expect(() => assertSafeControlledGitArguments('git-status-porcelain', [], '/repo')).toThrow(
      /subcommand|EMPTY_GIT_ARGUMENTS/i,
    );
    expect(() =>
      assertSafeControlledGitArguments('git-status-porcelain', ['push'], '/repo'),
    ).toThrow(/not allowlisted|FORBIDDEN_GIT_SUBCOMMAND/i);
    expect(() =>
      assertSafeControlledGitArguments('git-commit-message-file', ['commit', '-m', 'x'], '/repo'),
    ).toThrow(/INVALID_COMMIT_MESSAGE_FILE|Commit message file/i);
  });

  it('reports missing configured git executable via policy block', async () => {
    const repo = await createGitRepo();
    try {
      const runner = new ControlledGitRunner({
        repositoryRoot: repo.root,
        gitExecutable: path.join(repo.root, 'no-such-git-binary'),
      });
      const result = await runner.execute({
        id: 'git-status-porcelain',
        fixedArguments: ['status', '--porcelain=v1'],
        timeoutMs: 5_000,
        outputLimitBytes: 4_096,
        neutralizeHooks: false,
      });
      expect(result.policyBlocked).toBe(true);
      expect(result.policyBlockCode).toBe('GIT_EXECUTABLE_MISSING');
    } finally {
      await repo.cleanup();
    }
  });

  it('covers inspectDiff helper and commit branch drift paths', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 1;\n', 'utf8');
      const branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: repo.root,
        encoding: 'utf8',
      }).trim();
      bindings.put({
        preparationId: 'prep',
        projectId: 'builder-ai',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
        branchAtApply: branch,
      });
      const service = new ControlledGitService({
        appliedBindings: bindings,
        createRunner: (repositoryRoot) => new ControlledGitRunner({ repositoryRoot }),
      });
      const diff = await service.inspectDiff({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
      });
      expect(diff.commandId).toBe('git-diff-stat');

      const runner = new ControlledGitRunner({ repositoryRoot: repo.root });
      const helper = await createGitDiffStatResult(runner, (value) => JSON.stringify(value));
      expect(helper.commandId).toBe('git-diff-stat');
      expect(createGitDiffStatDescriptor().fixedArguments[0]).toBe('diff');

      const staged = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        requestedPaths: ['a.ts'],
        operatorApproved: true,
      });
      expect(staged.executionStatus).toBe('SUCCEEDED');

      const commitBranch = await service.commitSnapshot({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep',
        operatorApproved: true,
        expectedBranch: 'not-the-branch',
      });
      expect(commitBranch.policyBlockCode).toBe('BRANCH_MISMATCH');
    } finally {
      await repo.cleanup();
    }
  });

  it('rejects empty pathspecs and null-byte arguments', () => {
    expect(() => assertSafeControlledGitArguments('git-add-paths', ['add', '--'], '/repo')).toThrow(
      ControlledGitPolicyViolationError,
    );
    expect(() =>
      assertSafeControlledGitArguments('git-status-porcelain', ['status', 'bad\0arg'], '/repo'),
    ).toThrow(/Null bytes|FORBIDDEN_NULL_BYTE/i);
  });

  it('covers assertWritableGitState fail-closed branches', async () => {
    const { assertWritableGitState } = await import('../controlled-git/controlled-git-safety');
    const base = {
      repositoryRoot: '/repo',
      detachedHead: false,
      dirtyPaths: [] as string[],
      stagedPaths: [] as string[],
      unmergedPaths: [] as string[],
      inMerge: false,
      inRebase: false,
      inCherryPick: false,
      inBisect: false,
      indexLocked: false,
      gitDirIsDirectory: true,
      isInsideWorkTree: true,
    };
    expect(assertWritableGitState({ ...base, detachedHead: true }, new Set(['a.ts'])).ok).toBe(
      false,
    );
    expect(assertWritableGitState({ ...base, inRebase: true }, new Set(['a.ts'])).ok).toBe(false);
    expect(assertWritableGitState({ ...base, inCherryPick: true }, new Set(['a.ts'])).ok).toBe(
      false,
    );
    expect(assertWritableGitState({ ...base, inBisect: true }, new Set(['a.ts'])).ok).toBe(false);
    expect(assertWritableGitState({ ...base, unmergedPaths: ['a.ts'] }, new Set(['a.ts'])).ok).toBe(
      false,
    );
    expect(assertWritableGitState({ ...base, indexLocked: true }, new Set(['a.ts'])).ok).toBe(
      false,
    );
    expect(
      assertWritableGitState({ ...base, dirtyPaths: ['other.ts'] }, new Set(['a.ts'])).ok,
    ).toBe(false);
    expect(
      assertWritableGitState({ ...base, stagedPaths: ['other.ts'] }, new Set(['a.ts'])).ok,
    ).toBe(false);
    expect(assertWritableGitState(base, new Set()).ok).toBe(true);
  });

  it('covers inspect-git tool handler success and cancel paths', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      const { createInspectGitDiffTool } = await import('./tools/inspect-git-diff.tool');
      const { createInspectGitStatusTool } = await import('./tools/inspect-git-status.tool');
      const { createCommitGitSnapshotTool } = await import('./tools/commit-git-snapshot.tool');
      const service = new ControlledGitService({
        appliedBindings: bindings,
        createRunner: (repositoryRoot) => new ControlledGitRunner({ repositoryRoot }),
      });
      const diffTool = createInspectGitDiffTool({ controlledGit: service });
      const statusTool = createInspectGitStatusTool({ controlledGit: service });
      const commitTool = createCommitGitSnapshotTool({ controlledGit: service });
      const ctx = {
        runId: 'run',
        projectId: 'builder-ai',
        projectRoot: repo.root,
        phase: 'VERIFYING' as const,
        principal: { principalId: 'local-operator', projectId: 'builder-ai' },
        securityProfile: 'TRUSTED_LOCAL' as const,
        securityEvidence: { operatorApproved: true },
        cancellation: { cancelled: false, subscribe: () => () => undefined },
      };
      const diffOk = await diffTool.execute({}, ctx);
      expect(diffOk.summary).toMatch(/diff|Git/i);
      const statusOk = await statusTool.execute({}, ctx);
      expect(statusOk.summary).toMatch(/status|Git/i);
      const cancelled = await statusTool.execute(
        {},
        {
          ...ctx,
          cancellation: {
            cancelled: true,
            reason: 'stop',
            subscribe: () => () => undefined,
          },
        },
      );
      expect(cancelled.errorCode).toBe('CANCELLED');
      const diffCancelled = await diffTool.execute(
        {},
        {
          ...ctx,
          cancellation: {
            cancelled: true,
            reason: 'stop',
            subscribe: () => () => undefined,
          },
        },
      );
      expect(diffCancelled.errorCode).toBe('CANCELLED');
      const commitCancelled = await commitTool.execute(
        { preparationId: 'x' },
        {
          ...ctx,
          cancellation: {
            cancelled: true,
            reason: 'stop',
            subscribe: () => () => undefined,
          },
        },
      );
      expect(commitCancelled.errorCode).toBe('CANCELLED');
      const commitBadArgs = await commitTool.execute(null, ctx);
      expect(commitBadArgs.errorCode).toBe('INVALID_ARGS');
      const { createStageGitPathsTool } = await import('./tools/stage-git-paths.tool');
      const stageTool = createStageGitPathsTool({ controlledGit: service });
      const stageForbidden = await stageTool.execute(
        { preparationId: 'x', paths: ['a.ts'], '-c': 'evil' },
        ctx,
      );
      expect(stageForbidden.errorCode).toBe('FORBIDDEN_ARGUMENT');
      const failingDiffTool = createInspectGitDiffTool({
        controlledGit: {
          inspectDiff: async () => ({
            commandId: 'git-diff-stat',
            executionStatus: 'FAILED',
            exitCode: 1,
            timedOut: false,
            cancelled: false,
            policyBlocked: false,
            outputDigest: 'd',
            diagnosticSummary: 'failed',
            outputLimited: false,
          }),
        } as never,
      });
      const diffFailed = await failingDiffTool.execute({}, ctx);
      expect(diffFailed.errorCode).toBe('FAILED');
    } finally {
      await repo.cleanup();
    }
  });

  it('covers write isolation artifact prep and env forbid paths', async () => {
    const isolation = await prepareWriteIsolationArtifacts();
    expect(isolation.hooksPath.length).toBeGreaterThan(0);
    expect(isolation.isolatedConfigDir.length).toBeGreaterThan(0);
    expect(isForbiddenEnvironmentKey('GIT_TRACE')).toBe(true);
    expect(isForbiddenEnvironmentKey('PATH')).toBe(false);
    const env = buildControlledGitEnvironment({
      hooksPath: isolation.hooksPath,
      isolatedConfigDir: isolation.isolatedConfigDir,
    });
    expect(env.GIT_CONFIG_KEY_0).toBe('core.hooksPath');
    expect(env.GIT_CONFIG_VALUE_0).toBe(isolation.hooksPath);
  });

  it('covers remaining ControlledGitService policy branches', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      const service = new ControlledGitService({
        appliedBindings: bindings,
        createRunner: (repositoryRoot) => new ControlledGitRunner({ repositoryRoot }),
        defaultCommitMessage: 'default message',
      });

      expect(
        (
          await service.commitSnapshot({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'missing',
            operatorApproved: false,
          })
        ).policyBlockCode,
      ).toBe('OPERATOR_APPROVAL_REQUIRED');

      expect(
        (
          await service.commitSnapshot({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'missing',
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('STALE_FILE_APPLY_BINDING');

      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'missing',
            requestedPaths: [],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('STALE_FILE_APPLY_BINDING');

      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 1;\n', 'utf8');
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repo.root,
        encoding: 'utf8',
      }).trim();
      const branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: repo.root,
        encoding: 'utf8',
      }).trim();
      bindings.put({
        preparationId: 'prep',
        projectId: 'other-project',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
        headCommitAtApply: head,
        branchAtApply: branch,
      });
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
      ).toBe('STALE_FILE_APPLY_BINDING');

      const mismatchService = new ControlledGitService({
        appliedBindings: {
          readBinding: async () => ({
            preparationId: 'prep-mismatch',
            projectId: 'other-project',
            appliedPaths: ['a.ts'],
            appliedAt: '2026-08-22T12:00:00.000Z',
          }),
        },
        createRunner: (repositoryRoot) => new ControlledGitRunner({ repositoryRoot }),
      });
      expect(
        (
          await mismatchService.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep-mismatch',
            requestedPaths: ['a.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('PROJECT_MISMATCH');

      bindings.put({
        preparationId: 'prep2',
        projectId: 'builder-ai',
        appliedPaths: ['a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
        headCommitAtApply: head,
        branchAtApply: branch,
      });
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep2',
            requestedPaths: [],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('EMPTY_PATHSPEC');
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep2',
            requestedPaths: ['missing.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('PATH_NOT_IN_APPLIED_SET');
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep2',
            requestedPaths: ['*'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('FORBIDDEN_GLOB_PATHSPEC');

      const nonRepo = await mkdtemp(path.join(tmpdir(), 'builderai-b5-nongit-'));
      try {
        const status = await service.inspectStatus({
          projectId: 'builder-ai',
          repositoryRoot: nonRepo,
        });
        expect(status.executionStatus).toBe('REJECTED_BY_POLICY');
      } finally {
        await rm(nonRepo, { recursive: true, force: true });
      }

      const staged = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep2',
        requestedPaths: ['a.ts'],
        operatorApproved: true,
      });
      expect(staged.executionStatus).toBe('SUCCEEDED');
      const committed = await service.commitSnapshot({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep2',
        operatorApproved: true,
      });
      expect(committed.executionStatus).toBe('SUCCEEDED');
      expect(committed.commitHash).toMatch(/^[0-9a-f]+$/i);

      await writeFile(path.join(repo.root, 'a.ts'), 'export const a = 2;\n', 'utf8');
      expect(
        (
          await service.stagePaths({
            projectId: 'builder-ai',
            repositoryRoot: repo.root,
            preparationId: 'prep2',
            requestedPaths: ['a.ts'],
            operatorApproved: true,
          })
        ).policyBlockCode,
      ).toBe('BASELINE_DRIFT');
    } finally {
      await repo.cleanup();
    }
  });
});
