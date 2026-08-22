import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ChangePlannerService } from '../../../core/change-planner';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { VerificationCommandDescriptor } from '../../../core/verification/policy';
import type { SafeVerificationExecutionResult } from '../../../infrastructure/verification/safe-verification-runner';
import { SafeVerificationRunner } from '../../../infrastructure/verification/safe-verification-runner';
import { GeminiProvider } from '../../../providers/gemini';
import {
  createGeminiConfiguration,
  FakeGeminiClient,
} from '../../../providers/gemini/test/gemini-provider.fixture';
import { OpenAIProvider } from '../../../providers/openai';
import {
  createOpenAIConfiguration,
  FakeOpenAIResponsesClient,
} from '../../../providers/openai/test/openai-provider.fixture';
import { OpenRouterProvider } from '../../../providers/openrouter';
import {
  createOpenRouterConfiguration,
  FakeOpenRouterChatClient,
} from '../../../providers/openrouter/test/openrouter-provider.fixture';
import {
  ControlledTerminalService,
  type ControlledTerminalRunnerPort,
} from '../controlled-terminal/controlled-terminal.service';
import { EditProposalService } from '../edit-proposal/edit-proposal.service';
import { WorkspaceAuthorizationService } from '../workspace-authorization.service';
import {
  createB4TerminalRegistry,
  createControlledTerminalService,
} from './create-b4-terminal-registry';
import { ToolPolicyGate } from './tool-policy';
import { ToolRegistry } from './tool-registry';
import type { ToolExecutionContext, ToolJsonValue } from './tool-registry.types';
import {
  TOOL_RESULT_FORBIDDEN_KEYS,
  assertNoForbiddenToolResultPayload,
  sanitizeToolStructured,
} from './tool-result-sanitizer';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function cancellableToken(): ExecutionCancellationToken & { cancel(reason?: string): void } {
  let cancelled = false;
  let reason: string | undefined;
  const listeners = new Set<(reason?: string) => void>();
  return {
    get cancelled() {
      return cancelled;
    },
    get reason() {
      return reason;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancel(nextReason?: string) {
      cancelled = true;
      reason = nextReason;
      for (const listener of listeners) listener(nextReason);
    },
  };
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
    runId: 'run-b4',
    projectId: 'builder-ai',
    projectRoot: process.cwd(),
    phase: 'PLANNING',
    principal: { principalId: 'local-operator', projectId: 'builder-ai' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: true },
    cancellation: neverCancelled(),
    ...overrides,
  };
}

function successExecution(
  overrides: Partial<SafeVerificationExecutionResult> = {},
): SafeVerificationExecutionResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    policyBlocked: false,
    stdout: 'ok',
    stderr: '',
    stdoutLimited: false,
    stderrLimited: false,
    outputLimited: false,
    ...overrides,
  };
}

class RecordingRunner implements ControlledTerminalRunnerPort {
  readonly descriptors: VerificationCommandDescriptor[] = [];
  nextResult: SafeVerificationExecutionResult = successExecution();

  async execute(
    descriptor: VerificationCommandDescriptor,
    options?: {
      readonly cancellation?: ExecutionCancellationToken;
      readonly remainingWorkflowMs?: number;
    },
  ): Promise<SafeVerificationExecutionResult> {
    this.descriptors.push(descriptor);
    if (options?.cancellation?.cancelled) {
      return successExecution({ cancelled: true, exitCode: null, stdout: '' });
    }
    return this.nextResult;
  }
}

async function writeTempPackage(
  scripts: Record<string, string>,
): Promise<{ readonly root: string; readonly cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'builderai-b4-'));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'b4-fixture', private: true, scripts }, null, 2),
    'utf8',
  );
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function createB4Fixture(input: {
  readonly runner: RecordingRunner;
  readonly projectRoot: string;
  readonly projectId?: string;
}) {
  const authorization = authService(input.projectId);
  const source = {
    listSourcePaths: async () => ['src/existing.ts'],
    readSourceFile: async (logicalPath: string) => {
      if (logicalPath === 'src/existing.ts') return 'export const existing = 1;\n';
      throw new Error('missing');
    },
  };
  let idSeq = 0;
  const editProposals = new EditProposalService({
    changePlanner: new ChangePlannerService(),
    preparePort: {
      prepareFromResponsePackage: async () => {
        throw new Error('prepare unused in B4 fixture');
      },
    },
    clock: { now: () => new Date('2026-08-21T18:00:00.000Z') },
    ids: {
      generate: () => {
        idSeq += 1;
        return `b4-edit-${String(idSeq).padStart(4, '0')}`;
      },
    },
    expectedBaselineDigest: 'baseline-v1',
    readBaselineDigest: async () => 'baseline-v1',
  });

  const controlledTerminal = new ControlledTerminalService({
    createRunner: () => input.runner,
    stageTimeoutMs: 5_000,
    outputLimitBytes: 4_096,
  });

  const { registry, executor } = createB4TerminalRegistry({
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
  });

  return { registry, executor, controlledTerminal, authorization };
}

describe('ToolPolicyGate B4 VERIFY extension', () => {
  it('allows catalog-only VERIFY and rejects non-catalog VERIFY / MUTATE', () => {
    const policy = new ToolPolicyGate(authService());
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: {
        toolId: 'run_verification_command',
        name: 'Run',
        description: 'd',
        inputSchema: {},
        outputSchema: {},
        capabilityClass: 'VERIFY',
        readOnly: true,
        riskLevel: 'HIGH',
        authorizationAction: 'PREPARE',
        requiresGate2: false,
        approvalRequirement: 'NONE',
        workspaceScoped: true,
        timeoutMs: 5_000,
        supportsCancellation: true,
        evidencePolicy: 'DIGEST',
        auditPolicy: 'DIGEST',
        allowedPhases: ['PLANNING'],
      },
      execute: async () => ({ summary: 'ok' }),
    });

    expect(() =>
      registry.register({
        definition: {
          toolId: 'bad_verify',
          name: 'Bad',
          description: 'd',
          inputSchema: {},
          outputSchema: {},
          capabilityClass: 'VERIFY',
          readOnly: true,
          riskLevel: 'LOW',
          authorizationAction: 'PREPARE',
          requiresGate2: false,
          approvalRequirement: 'NONE',
          workspaceScoped: true,
          timeoutMs: 5_000,
          supportsCancellation: true,
          evidencePolicy: 'DIGEST',
          auditPolicy: 'DIGEST',
          allowedPhases: ['PLANNING'],
        },
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/catalog-only|HIGH|VERIFY/i);

    expect(() =>
      registry.register({
        definition: {
          toolId: 'mutate_files',
          name: 'Mutate',
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
    ).toThrow(/readOnly|APPLY|unavailable|catalog-only/i);
  });
});

describe('B4 controlled terminal composition matrix (T1–T14)', () => {
  it('covers catalog policy, sanitizer, auth, freeze, and runner reuse', async () => {
    const fixture = await writeTempPackage({
      build: 'echo build',
      test: 'echo test',
      lint: 'echo lint',
      typecheck: 'echo typecheck',
      'format:check': 'echo format',
    });
    const runner = new RecordingRunner();

    try {
      const { registry, executor } = createB4Fixture({
        runner,
        projectRoot: fixture.root,
      });

      // T12 — additive B4; B1–B3 ids frozen.
      const toolIds = registry.listDefinitions().map((d) => d.toolId);
      expect(toolIds).toEqual(
        expect.arrayContaining([
          'search_repository',
          'read_source_file',
          'inspect_readiness',
          'find_related_files',
          'retrieve_relevant_context',
          'inspect_file_outline',
          'inspect_imports',
          'draft_edit_proposal',
          'inspect_edit_proposal',
          'commit_edit_proposal',
          'run_verification_command',
          'inspect_verification_catalog',
        ]),
      );
      expect(registry.listDefinitions().every((d) => d.readOnly)).toBe(true);
      expect(registry.listDefinitions().every((d) => d.authorizationAction !== 'APPLY')).toBe(true);

      // T8 / T11 — no FileApply / unrestricted shell surface.
      expect(registry.dependencySurface().join(',')).not.toMatch(/FileApply/i);
      expect(toolIds).not.toEqual(expect.arrayContaining(['run_shell', 'exec', 'git_write']));

      // T9 — MUTATE / non-readOnly still rejected (covered above + registry flags).
      const verifyDef = registry
        .listDefinitions()
        .find((d) => d.toolId === 'run_verification_command');
      expect(verifyDef?.capabilityClass).toBe('VERIFY');
      expect(verifyDef?.riskLevel).toBe('HIGH');
      expect(verifyDef?.requiresGate2).toBe(false);

      // Catalog inspect (no spawn).
      const catalog = await executor.execute(
        { callId: 'c1', toolId: 'inspect_verification_catalog', args: {} },
        baseContext({ projectRoot: fixture.root }),
      );
      expect(catalog.status).toBe('SUCCEEDED');
      assertNoForbiddenToolResultPayload(catalog);
      const catalogStructured = catalog.structured as {
        readonly availableCount: number;
        readonly totalCount: number;
      };
      expect(catalogStructured.totalCount).toBe(6);
      expect(catalogStructured.availableCount).toBe(6);
      expect(runner.descriptors).toHaveLength(0);

      // T1 — only catalog commandIds; free-form rejected.
      const freeForm = await executor.execute(
        {
          callId: 't1a',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-build', command: 'rm -rf /' },
        },
        baseContext({ projectRoot: fixture.root }),
      );
      expect(freeForm.status).toBe('FAILED');
      expect(freeForm.errorCode).toBe('FORBIDDEN_ARGUMENT');
      expect(runner.descriptors).toHaveLength(0);

      const unknownId = await executor.execute(
        {
          callId: 't1b',
          toolId: 'run_verification_command',
          args: { commandId: 'bash -c whoami' },
        },
        baseContext({ projectRoot: fixture.root }),
      );
      expect(unknownId.status).toBe('FAILED');
      expect(unknownId.errorCode).toBe('UNKNOWN_COMMAND_ID');
      expect(runner.descriptors).toHaveLength(0);

      // T2 — forbidden exec/npm never spawned (catalog cannot express them).
      for (const bad of ['npx', 'node', 'powershell', 'git', 'npm install']) {
        const blocked = await executor.execute(
          {
            callId: `t2-${bad}`,
            toolId: 'run_verification_command',
            args: { commandId: bad },
          },
          baseContext({ projectRoot: fixture.root }),
        );
        expect(blocked.errorCode).toBe('UNKNOWN_COMMAND_ID');
      }
      expect(runner.descriptors).toHaveLength(0);

      // Successful catalog run maps to existing descriptor (T3 cwd via descriptor policy).
      runner.nextResult = successExecution({ stdout: 'build ok', stderr: '' });
      const build = await executor.execute(
        {
          callId: 't-build',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-build' },
        },
        baseContext({ projectRoot: fixture.root }),
      );
      expect(build.status).toBe('SUCCEEDED');
      expect(runner.descriptors).toHaveLength(1);
      expect(runner.descriptors[0]?.id).toBe('npm-run-build');
      expect(runner.descriptors[0]?.fixedArguments).toEqual(['run', 'build']);
      expect(runner.descriptors[0]?.workingDirectoryPolicy).toBe('project-root');
      expect(runner.descriptors[0]?.environmentPolicy).toBe('allowlisted-minimal');

      // T5 — sanitizer-safe keys (no stdout/stderr).
      const structured = build.structured as Record<string, unknown>;
      for (const key of TOOL_RESULT_FORBIDDEN_KEYS) {
        expect(structured).not.toHaveProperty(key);
      }
      expect(structured).toHaveProperty('outputDigest');
      expect(structured).toHaveProperty('diagnosticSummary');
      expect(sanitizeToolStructured(structured as ToolJsonValue)).toMatchObject({
        commandId: 'npm-run-build',
        executionStatus: 'SUCCEEDED',
      });
      assertNoForbiddenToolResultPayload(build);

      // T4 — env not accepted from tool args.
      const envInject = await executor.execute(
        {
          callId: 't4',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-test', env: { SECRET: 'x' } },
        },
        baseContext({ projectRoot: fixture.root }),
      );
      expect(envInject.errorCode).toBe('FORBIDDEN_ARGUMENT');

      // T6 — cancel before/during.
      const token = cancellableToken();
      token.cancel('operator-cancel');
      const cancelled = await executor.execute(
        {
          callId: 't6',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-test' },
        },
        baseContext({ projectRoot: fixture.root, cancellation: token }),
      );
      expect(cancelled.status).toBe('CANCELLED');

      // T7 — timeout reported from runner.
      runner.nextResult = successExecution({
        timedOut: true,
        exitCode: null,
        stdout: '',
        stderr: 'hung',
      });
      const timedOut = await executor.execute(
        {
          callId: 't7',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-test' },
        },
        baseContext({ projectRoot: fixture.root }),
      );
      expect(timedOut.errorCode).toBe('TIMEOUT');
      expect((timedOut.structured as { timedOut: boolean }).timedOut).toBe(true);

      // T13 — side-effect note: build does not call FileApply (runner only).
      const fileApplyMentions = JSON.stringify(registry.listDefinitions());
      expect(fileApplyMentions).not.toMatch(/FileApply|approveAndApply/i);

      // T14 — trusted-local project mismatch denied.
      const mismatch = await executor.execute(
        {
          callId: 't14',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-build' },
        },
        baseContext({
          projectRoot: fixture.root,
          projectId: 'builder-ai',
          principal: { principalId: 'local-operator', projectId: 'other-project' },
        }),
      );
      expect(mismatch.status).toBe('REJECTED_BY_POLICY');
      expect(mismatch.errorCode).toBe('PROJECT_MISMATCH');

      // Script unavailable (no spawn).
      const emptyPkg = await writeTempPackage({});
      try {
        const emptyRunner = new RecordingRunner();
        const emptyFixture = createB4Fixture({
          runner: emptyRunner,
          projectRoot: emptyPkg.root,
        });
        const unavailable = await emptyFixture.executor.execute(
          {
            callId: 'unavailable',
            toolId: 'run_verification_command',
            args: { commandId: 'npm-run-build' },
          },
          baseContext({ projectRoot: emptyPkg.root }),
        );
        expect(unavailable.errorCode).toBe('SCRIPT_UNAVAILABLE');
        expect(emptyRunner.descriptors).toHaveLength(0);
      } finally {
        await emptyPkg.cleanup();
      }

      // T10 — providers remain toolCalling: false.
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

      // Production helper still constructs SafeVerificationRunner (reuse, not second engine).
      const production = createControlledTerminalService({
        stageTimeoutMs: 1_000,
        outputLimitBytes: 1_024,
      });
      expect(production).toBeInstanceOf(ControlledTerminalService);
      expect(SafeVerificationRunner.name).toBe('SafeVerificationRunner');
    } finally {
      await fixture.cleanup();
    }
  });

  it('covers run/inspect tool edge branches without spawn', async () => {
    const runner = new RecordingRunner();
    runner.nextResult = successExecution({ exitCode: 1, stdout: '', stderr: 'fail' });
    const { executor, registry } = createB4Fixture({
      runner,
      projectRoot: '/unused',
    });

    const pkg = await writeTempPackage({
      build: 'echo build',
      test: 'echo test',
      lint: 'echo lint',
      typecheck: 'echo tc',
      'format:check': 'echo fmt',
    });
    try {
      const failed = await executor.execute(
        {
          callId: 'fail',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-build' },
        },
        baseContext({ projectRoot: pkg.root }),
      );
      expect(failed.errorCode).toBe('COMMAND_FAILED');

      const invalidArgs = await executor.execute(
        {
          callId: 'bad-args',
          toolId: 'run_verification_command',
          args: ['not-an-object'],
        },
        baseContext({ projectRoot: pkg.root }),
      );
      expect(invalidArgs.errorCode).toBe('INVALID_ARGS');

      const emptyRoot = await executor.execute(
        {
          callId: 'empty-root',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-build' },
        },
        baseContext({ projectRoot: '   ' }),
      );
      expect(emptyRoot.errorCode).toBe('INVALID_CONTEXT');

      const phaseDenied = await executor.execute(
        {
          callId: 'phase',
          toolId: 'run_verification_command',
          args: { commandId: 'npm-run-build' },
        },
        baseContext({ projectRoot: pkg.root, phase: 'EXECUTING' }),
      );
      expect(phaseDenied.status).toBe('REJECTED_BY_POLICY');
      expect(phaseDenied.errorCode).toBe('PHASE_NOT_ALLOWED');

      const catalogEmptyRoot = await executor.execute(
        { callId: 'cat-empty', toolId: 'inspect_verification_catalog', args: {} },
        baseContext({ projectRoot: '' }),
      );
      expect(catalogEmptyRoot.errorCode).toBe('INVALID_CONTEXT');

      const runDef = registry
        .listDefinitions()
        .find((d) => d.toolId === 'run_verification_command');
      expect(runDef?.timeoutMs).toBe(120_000);
    } finally {
      await pkg.cleanup();
    }
  });

  it('T3 — rejects BuilderAI root when builderAiRoot confinement is configured', async () => {
    const outer = await mkdtemp(path.join(tmpdir(), 'builderai-b4-confinement-'));
    const builderRoot = path.join(outer, 'builderai');
    const targetRoot = path.join(outer, 'target');
    await mkdir(builderRoot, { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await writeFile(
      path.join(builderRoot, 'package.json'),
      JSON.stringify({ name: 'builderai', private: true, scripts: { build: 'echo x' } }),
      'utf8',
    );
    await writeFile(
      path.join(targetRoot, 'package.json'),
      JSON.stringify({ name: 'target', private: true, scripts: { build: 'echo x' } }),
      'utf8',
    );

    try {
      const service = createControlledTerminalService({
        builderAiRoot: builderRoot,
        stageTimeoutMs: 2_000,
        outputLimitBytes: 2_048,
      });

      const blocked = await service.runCommand({
        commandId: 'npm-run-build',
        projectRoot: builderRoot,
      });
      expect(blocked.executionStatus).toBe('REJECTED_BY_POLICY');
      expect(blocked.policyBlockCode).toMatch(/BUILDERAI_ROOT_FORBIDDEN|WORKING_DIRECTORY/i);
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });
});
