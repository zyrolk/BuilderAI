/**
 * @vitest-environment node
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { ChangePlannerService } from '../../../core/change-planner';
import { OpenAIProvider } from '../../../providers/openai';
import {
  createOpenAIConfiguration,
  FakeOpenAIResponsesClient,
} from '../../../providers/openai/test/openai-provider.fixture';
import { GeminiProvider } from '../../../providers/gemini';
import {
  createGeminiConfiguration,
  FakeGeminiClient,
} from '../../../providers/gemini/test/gemini-provider.fixture';
import { OpenRouterProvider } from '../../../providers/openrouter';
import {
  createOpenRouterConfiguration,
  FakeOpenRouterChatClient,
} from '../../../providers/openrouter/test/openrouter-provider.fixture';
import { ControlledTerminalService } from '../controlled-terminal/controlled-terminal.service';
import { InMemoryAppliedFileApplyBindingStore } from '../controlled-git/applied-file-apply-binding.port';
import { ControlledGitService } from '../controlled-git/controlled-git.service';
import { EditProposalService } from '../edit-proposal/edit-proposal.service';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import { ControlledGitRunner } from '../../../infrastructure/controlled-git/controlled-git-runner';
import {
  assertSafeControlledGitArguments,
  buildControlledGitEnvironment,
  ControlledGitPolicyViolationError,
} from '../../../infrastructure/controlled-git/controlled-git-environment';
import { createB5GitRegistry, createControlledGitService } from './create-b5-git-registry';
import { ToolPolicyGate } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import type { ToolExecutionContext } from './tool-registry.types';
import { assertNoForbiddenToolResultPayload } from './tool-result-sanitizer';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function authService(projectId = 'builder-ai'): WorkspaceAuthorizationService {
  return new WorkspaceAuthorizationService({
    profile: 'TRUSTED_LOCAL',
    projectId,
    principalId: 'local-operator',
  });
}

function baseContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-b5',
    projectId: 'builder-ai',
    projectRoot: process.cwd(),
    phase: 'VERIFYING',
    principal: { principalId: 'local-operator', projectId: 'builder-ai' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: true },
    cancellation: neverCancelled(),
    ...overrides,
  };
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

async function createGitRepo(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'builderai-b5-'));
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

function createB5Fixture(input: {
  readonly projectRoot: string;
  readonly bindings: InMemoryAppliedFileApplyBindingStore;
}) {
  const authorization = authService();
  const source = {
    listSourcePaths: async () => ['src/a.ts'],
    readSourceFile: async () => 'export const a = 1;\n',
  };
  let idSeq = 0;
  const editProposals = new EditProposalService({
    changePlanner: new ChangePlannerService(),
    preparePort: {
      prepareFromResponsePackage: async () => {
        throw new Error('unused');
      },
    },
    clock: { now: () => new Date('2026-08-22T12:00:00.000Z') },
    ids: {
      generate: () => {
        idSeq += 1;
        return `b5-${String(idSeq).padStart(4, '0')}`;
      },
    },
    expectedBaselineDigest: 'b',
    readBaselineDigest: async () => 'b',
  });

  const controlledTerminal = new ControlledTerminalService({
    createRunner: () => ({
      execute: async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        cancelled: false,
        policyBlocked: false,
        stdout: '',
        stderr: '',
        stdoutLimited: false,
        stderrLimited: false,
        outputLimited: false,
      }),
    }),
    discoverScripts: () => ({
      hasBuild: false,
      hasTest: false,
      lintScript: undefined,
      typecheckScript: undefined,
      formatScript: undefined,
    }),
  });

  const controlledGit = createControlledGitService({
    appliedBindings: input.bindings,
  });

  const { registry, executor } = createB5GitRegistry({
    authorization,
    search: source,
    read: { readSourceFile: source.readSourceFile },
    readiness: {
      project: async () => {
        throw new Error('unused');
      },
    },
    related: source,
    relevantContext: source,
    outline: { readSourceFile: source.readSourceFile },
    imports: source,
    editProposals,
    controlledTerminal,
    controlledGit,
  });

  return { registry, executor, controlledGit };
}

describe('ToolPolicyGate B5 GIT extensions', () => {
  it('allows GIT_READ and OPERATOR GIT_WRITE; rejects MUTATE and push-shaped tools', () => {
    const policy = new ToolPolicyGate(authService());
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: {
        toolId: 'inspect_git_status',
        name: 'Status',
        description: 'd',
        inputSchema: {},
        outputSchema: {},
        capabilityClass: 'GIT_READ',
        readOnly: true,
        riskLevel: 'LOW',
        authorizationAction: 'INVESTIGATE',
        requiresGate2: false,
        approvalRequirement: 'NONE',
        workspaceScoped: true,
        timeoutMs: 5_000,
        supportsCancellation: true,
        evidencePolicy: 'SUMMARY',
        auditPolicy: 'DIGEST',
        allowedPhases: ['VERIFYING'],
      },
      execute: async () => ({ summary: 'ok' }),
    });
    registry.register({
      definition: {
        toolId: 'stage_git_paths',
        name: 'Stage',
        description: 'd',
        inputSchema: {},
        outputSchema: {},
        capabilityClass: 'GIT_WRITE',
        readOnly: true,
        riskLevel: 'HIGH',
        authorizationAction: 'GIT_WRITE',
        requiresGate2: false,
        approvalRequirement: 'OPERATOR',
        workspaceScoped: true,
        timeoutMs: 5_000,
        supportsCancellation: true,
        evidencePolicy: 'DIGEST',
        auditPolicy: 'DIGEST',
        allowedPhases: ['VERIFYING'],
      },
      execute: async () => ({ summary: 'ok' }),
    });

    expect(() =>
      registry.register({
        definition: {
          toolId: 'git_push',
          name: 'Push',
          description: 'd',
          inputSchema: {},
          outputSchema: {},
          capabilityClass: 'MUTATE',
          readOnly: false,
          riskLevel: 'CRITICAL',
          authorizationAction: 'APPLY',
          requiresGate2: true,
          approvalRequirement: 'GATE2',
          workspaceScoped: true,
          timeoutMs: 5_000,
          supportsCancellation: true,
          evidencePolicy: 'NONE',
          auditPolicy: 'NONE',
          allowedPhases: ['EXECUTING'],
        },
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/readOnly|APPLY|unavailable/i);
  });
});

describe('B5 controlled Git composition matrix', { timeout: 120_000 }, () => {
  it('covers stage/commit path binding, policy rejects, and freezes', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await mkdir(path.join(repo.root, 'src'), { recursive: true });
      await writeFile(
        path.join(repo.root, 'src', 'applied.ts'),
        'export const applied = 1;\n',
        'utf8',
      );
      await writeFile(path.join(repo.root, 'src', 'unrelated.ts'), 'export const x = 1;\n', 'utf8');

      bindings.put({
        preparationId: 'prep-1',
        projectId: 'builder-ai',
        appliedPaths: ['src/applied.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
        branchAtApply: execFileSync('git', ['branch', '--show-current'], {
          cwd: repo.root,
          encoding: 'utf8',
        }).trim(),
      });

      const { registry, executor } = createB5Fixture({
        projectRoot: repo.root,
        bindings,
      });

      const toolIds = registry.listDefinitions().map((d) => d.toolId);
      expect(toolIds).toEqual(
        expect.arrayContaining([
          'run_verification_command',
          'inspect_git_status',
          'inspect_git_diff',
          'stage_git_paths',
          'commit_git_snapshot',
        ]),
      );
      expect(toolIds).not.toEqual(expect.arrayContaining(['git_push', 'run_shell']));
      expect(registry.dependencySurface().join(',')).not.toMatch(/FileApply/i);

      // Status/diff succeed.
      const status = await executor.execute(
        { callId: 's1', toolId: 'inspect_git_status', args: {} },
        baseContext({ projectRoot: repo.root, phase: 'VERIFYING' }),
      );
      expect(status.status).toBe('SUCCEEDED');
      assertNoForbiddenToolResultPayload(status);

      // OPERATOR required.
      const noApproval = await executor.execute(
        {
          callId: 'st0',
          toolId: 'stage_git_paths',
          args: { preparationId: 'prep-1', paths: ['src/applied.ts'] },
        },
        baseContext({
          projectRoot: repo.root,
          securityEvidence: { operatorApproved: false },
        }),
      );
      expect(noApproval.status).toBe('REJECTED_BY_POLICY');
      expect(noApproval.errorCode).toBe('OPERATOR_APPROVAL_REQUIRED');

      // Forbidden argv fields.
      const malicious = await executor.execute(
        {
          callId: 'bad',
          toolId: 'stage_git_paths',
          args: {
            preparationId: 'prep-1',
            paths: ['src/applied.ts'],
            '-c': 'core.hooksPath=/tmp',
          },
        },
        baseContext({ projectRoot: repo.root }),
      );
      expect(malicious.errorCode).toBe('FORBIDDEN_ARGUMENT');

      // Unrelated dirty path blocks write.
      const unrelated = await executor.execute(
        {
          callId: 'st1',
          toolId: 'stage_git_paths',
          args: { preparationId: 'prep-1', paths: ['src/applied.ts'] },
        },
        baseContext({ projectRoot: repo.root }),
      );
      expect(unrelated.errorCode).toBe('UNRELATED_DIRTY_PATHS');

      // Remove unrelated dirty file from tree by matching applied-only dirty state:
      await rm(path.join(repo.root, 'src', 'unrelated.ts'), { force: true });
      // Keep only applied.ts dirty.
      const stage = await executor.execute(
        {
          callId: 'st2',
          toolId: 'stage_git_paths',
          args: { preparationId: 'prep-1', paths: ['src/applied.ts'] },
        },
        baseContext({ projectRoot: repo.root }),
      );
      expect(stage.status).toBe('SUCCEEDED');

      const commit = await executor.execute(
        {
          callId: 'c1',
          toolId: 'commit_git_snapshot',
          args: { preparationId: 'prep-1', commitMessage: 'b5 applied snapshot' },
        },
        baseContext({ projectRoot: repo.root }),
      );
      expect(commit.status).toBe('SUCCEEDED');
      expect((commit.structured as { commitHash?: string }).commitHash).toMatch(
        /^[0-9a-f]{7,40}$/i,
      );

      // Path not in applied set.
      await writeFile(path.join(repo.root, 'src', 'other.ts'), 'export const o = 1;\n', 'utf8');
      bindings.put({
        preparationId: 'prep-2',
        projectId: 'builder-ai',
        appliedPaths: ['src/other.ts'],
        appliedAt: '2026-08-22T12:01:00.000Z',
      });
      // Also dirty applied.ts from nowhere - ensure only other.ts dirty... rewrite applied clean via checkout is forbidden in product; instead reset file content to HEAD via write of committed content.
      const committedApplied = 'export const applied = 1;\n';
      await writeFile(path.join(repo.root, 'src', 'applied.ts'), committedApplied, 'utf8');
      // If applied.ts matches HEAD it may still show clean; only other.ts dirty.
      const notAllowed = await executor.execute(
        {
          callId: 'st3',
          toolId: 'stage_git_paths',
          args: { preparationId: 'prep-2', paths: ['src/applied.ts'] },
        },
        baseContext({ projectRoot: repo.root }),
      );
      expect(notAllowed.errorCode).toBe('PATH_NOT_IN_APPLIED_SET');

      // Stale binding.
      const stale = await executor.execute(
        {
          callId: 'st4',
          toolId: 'stage_git_paths',
          args: { preparationId: 'missing', paths: ['src/other.ts'] },
        },
        baseContext({ projectRoot: repo.root }),
      );
      expect(stale.errorCode).toBe('STALE_FILE_APPLY_BINDING');

      // Project mismatch.
      const mismatch = await executor.execute(
        {
          callId: 'st5',
          toolId: 'inspect_git_status',
          args: {},
        },
        baseContext({
          projectRoot: repo.root,
          projectId: 'builder-ai',
          principal: { principalId: 'local-operator', projectId: 'other' },
        }),
      );
      expect(mismatch.errorCode).toBe('PROJECT_MISMATCH');

      // B4 cannot express git.
      const b4git = await executor.execute(
        {
          callId: 'b4g',
          toolId: 'run_verification_command',
          args: { commandId: 'git' },
        },
        baseContext({ projectRoot: repo.root, phase: 'PLANNING' }),
      );
      expect(b4git.errorCode).toBe('UNKNOWN_COMMAND_ID');

      // Providers toolCalling false.
      expect(
        new OpenAIProvider(createOpenAIConfiguration(), new FakeOpenAIResponsesClient()).descriptor
          .capabilities.toolCalling,
      ).toBe(false);
      expect(
        new GeminiProvider(createGeminiConfiguration(), new FakeGeminiClient()).descriptor
          .capabilities.toolCalling,
      ).toBe(false);
      expect(
        new OpenRouterProvider(createOpenRouterConfiguration(), new FakeOpenRouterChatClient())
          .descriptor.capabilities.toolCalling,
      ).toBe(false);
    } finally {
      await repo.cleanup();
    }
  }, 120_000);

  it('rejects forbidden argv, env leakage keys, and BuilderAI root', async () => {
    expect(() =>
      assertSafeControlledGitArguments(
        'git-status-porcelain',
        ['-c', 'core.hooksPath=/tmp'],
        '/repo',
      ),
    ).toThrow(ControlledGitPolicyViolationError);

    expect(() =>
      assertSafeControlledGitArguments('git-add-paths', ['add', '--', '../secret'], '/repo'),
    ).toThrow(/Unsafe Git pathspec|PATH_ESCAPE|UNSAFE_PATHSPEC/);

    const env = buildControlledGitEnvironment({});
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(Object.keys(env).some((key) => key.startsWith('BUILDERAI_'))).toBe(false);

    const outer = await mkdtemp(path.join(tmpdir(), 'builderai-b5-conf-'));
    const builderRoot = path.join(outer, 'builderai');
    await mkdir(builderRoot, { recursive: true });
    try {
      expect(
        () =>
          new ControlledGitRunner({
            repositoryRoot: builderRoot,
            builderAiRoot: builderRoot,
          }),
      ).toThrow(/BuilderAI repository root|BUILDERAI_ROOT_FORBIDDEN|REPOSITORY/);
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  it('service rejects detached HEAD and does not destructively rollback on commit policy failure', async () => {
    const repo = await createGitRepo();
    const bindings = new InMemoryAppliedFileApplyBindingStore();
    try {
      await writeFile(path.join(repo.root, 'src-a.ts'), 'export const a = 1;\n', 'utf8');
      bindings.put({
        preparationId: 'prep-det',
        projectId: 'builder-ai',
        appliedPaths: ['src-a.ts'],
        appliedAt: '2026-08-22T12:00:00.000Z',
      });
      git(repo.root, ['checkout', '--detach', 'HEAD']);

      const service = new ControlledGitService({
        appliedBindings: bindings,
        createRunner: (repositoryRoot) => new ControlledGitRunner({ repositoryRoot }),
      });
      const staged = await service.stagePaths({
        projectId: 'builder-ai',
        repositoryRoot: repo.root,
        preparationId: 'prep-det',
        requestedPaths: ['src-a.ts'],
        operatorApproved: true,
      });
      expect(staged.policyBlockCode).toBe('DETACHED_HEAD');
      // No destructive recovery: detached HEAD still present.
      const branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: repo.root,
        encoding: 'utf8',
      }).trim();
      expect(branch).toBe('');
    } finally {
      await repo.cleanup();
    }
  });
});
