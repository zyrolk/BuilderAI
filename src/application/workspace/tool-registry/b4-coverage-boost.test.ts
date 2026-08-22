import { describe, expect, it } from 'vitest';

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { SafeVerificationExecutionResult } from '../../../infrastructure/verification/safe-verification-runner';
import {
  ControlledTerminalService,
  type ControlledTerminalRunnerPort,
} from '../controlled-terminal/controlled-terminal.service';
import type { EditProposalService } from '../edit-proposal/edit-proposal.service';
import { EditProposalError } from '../edit-proposal/edit-proposal.types';
import type { ExternalTargetReadiness } from '../external-target-readiness/external-target-readiness.types';
import { createControlledTerminalService } from './create-b4-terminal-registry';
import type { ToolExecutionContext } from './tool-registry.types';
import { createCommitEditProposalTool } from './tools/commit-edit-proposal.tool';
import { createDraftEditProposalTool } from './tools/draft-edit-proposal.tool';
import { createInspectEditProposalTool } from './tools/inspect-edit-proposal.tool';
import { createInspectReadinessTool } from './tools/inspect-readiness.tool';
import { createInspectVerificationCatalogTool } from './tools/inspect-verification-catalog.tool';
import { createReadSourceFileTool } from './tools/read-source-file.tool';
import { createRunVerificationCommandTool } from './tools/run-verification-command.tool';
import { createSearchRepositoryTool } from './tools/search-repository.tool';
import { TOOL_RESULT_FORBIDDEN_KEYS, sanitizeToolStructured } from './tool-result-sanitizer';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function baseContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-cov',
    projectId: 'builder-ai',
    projectRoot: '/proj',
    phase: 'PLANNING',
    principal: { principalId: 'local-operator', projectId: 'builder-ai' },
    securityProfile: 'TRUSTED_LOCAL',
    securityEvidence: { operatorApproved: true },
    cancellation: neverCancelled(),
    ...overrides,
  };
}

class FakeRunner implements ControlledTerminalRunnerPort {
  next: SafeVerificationExecutionResult = {
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
  };

  async execute(): Promise<SafeVerificationExecutionResult> {
    return this.next;
  }
}

const READY_FIXTURE = {
  schemaVersion: 1,
  status: 'READY_WITH_WARNINGS',
  profile: 'EXTERNAL_TARGET',
  projectId: 'builder-ai',
  projectName: 'BuilderAI',
  projectRootDisplay: '/proj',
  runtimeConnected: true,
  sourceRoots: ['src'],
  testRoots: ['src'],
  protectedAreas: [],
  indexedFileCount: 1,
  verification: {
    build: true,
    test: true,
    lint: true,
    typecheck: true,
    format: true,
    devServer: false,
    browserVerification: false,
  },
  blockers: [],
  warnings: [{ code: 'W1', message: 'warn', severity: 'WARNING' }],
} as unknown as ExternalTargetReadiness;

describe('B4 coverage boost for CI branch threshold', () => {
  it('covers createControlledTerminalService custom runner option', async () => {
    const runner = new FakeRunner();
    const service = createControlledTerminalService({
      createRunner: () => runner,
      diagnosticSummaryMaxChars: 64,
      builderAiRoot: undefined,
      stageTimeoutMs: 1_000,
      outputLimitBytes: 2_048,
    });
    runner.next = {
      ...runner.next,
      policyBlocked: true,
      exitCode: null,
      stdout: '',
      stderr: '',
    };
    const blocked = await service.runCommand({
      commandId: 'npm-ls-omit-dev-json',
      projectRoot: '/proj',
    });
    expect(blocked.executionStatus).toBe('REJECTED_BY_POLICY');

    // Hit remaining optional-config / catalog definition export branch.
    const { inspectVerificationCatalogToolDefinition } =
      await import('./tools/inspect-verification-catalog.tool');
    expect(inspectVerificationCatalogToolDefinition().toolId).toBe('inspect_verification_catalog');

    // Default factory option branches (stageTimeoutMs/outputLimitBytes fallbacks).
    const defaults = createControlledTerminalService({});
    const unavailable = await defaults.runCommand({
      commandId: 42 as unknown as string,
      projectRoot: '/proj',
    });
    expect(unavailable.policyBlockCode).toBe('UNKNOWN_COMMAND_ID');
  });

  it('covers B3 proposal tool cancel/error branches via direct handlers', async () => {
    const editProposals = {
      draft: () => {
        throw new EditProposalError('PROTECTED_PATH', 'blocked');
      },
      inspect: () => {
        throw new EditProposalError('NOT_FOUND', 'empty');
      },
      commit: async () => {
        throw new Error('boom');
      },
    } as unknown as EditProposalService;

    const draft = createDraftEditProposalTool({ editProposals });
    const inspect = createInspectEditProposalTool({ editProposals });
    const commit = createCommitEditProposalTool({ editProposals });

    expect(
      (
        await draft.execute(
          {},
          baseContext({
            cancellation: { cancelled: true, reason: 'x', subscribe: () => () => undefined },
          }),
        )
      ).errorCode,
    ).toBe('CANCELLED');

    expect(
      (
        await commit.execute(
          {},
          baseContext({
            cancellation: { cancelled: true, reason: 'x', subscribe: () => () => undefined },
          }),
        )
      ).errorCode,
    ).toBe('CANCELLED');

    const draftDenied = await draft.execute(
      {
        replace: true,
        operations: [
          {
            kind: 'CREATE_FILE',
            logicalPath: 'src/a.ts',
            description: 'a',
            content: 'export const a = 1;\n',
          },
        ],
      },
      baseContext(),
    );
    expect(draftDenied.errorCode).toBe('PROTECTED_PATH');

    const inspectDenied = await inspect.execute({}, baseContext());
    expect(inspectDenied.errorCode).toBe('NOT_FOUND');

    const commitFailed = await commit.execute({}, baseContext());
    expect(commitFailed.errorCode).toBe('COMMIT_FAILED');

    const commitPolicy = createCommitEditProposalTool({
      editProposals: {
        commit: async () => {
          throw new EditProposalError('STALE_BASELINE', 'stale');
        },
      } as unknown as EditProposalService,
    });
    expect((await commitPolicy.execute({}, baseContext())).errorCode).toBe('STALE_BASELINE');

    const inspectThrowing = createInspectEditProposalTool({
      editProposals: {
        inspect: () => {
          throw new Error('inspect boom');
        },
      } as unknown as EditProposalService,
    });
    expect((await inspectThrowing.execute({}, baseContext())).errorCode).toBe('INSPECT_FAILED');
  });

  it('covers readiness/search/read/catalog/sanitizer edge branches', async () => {
    const readiness = createInspectReadinessTool({
      project: async () => READY_FIXTURE,
    });
    expect(
      (
        await readiness.execute(
          {},
          baseContext({
            cancellation: { cancelled: true, reason: 'stop', subscribe: () => () => undefined },
          }),
        )
      ).errorCode,
    ).toBe('CANCELLED');
    expect((await readiness.execute({}, baseContext({ projectRoot: '' }))).errorCode).toBe(
      'INVALID_CONTEXT',
    );
    const ready = await readiness.execute({}, baseContext());
    expect(ready.structured).toMatchObject({ status: 'READY_WITH_WARNINGS', warningCount: 1 });

    // Mid-flight cancel after project() starts returning.
    let resolveProject: ((value: ExternalTargetReadiness) => void) | undefined;
    const pendingReadiness = createInspectReadinessTool({
      project: () =>
        new Promise<ExternalTargetReadiness>((resolve) => {
          resolveProject = resolve;
        }),
    });
    const token = {
      cancelled: false,
      reason: undefined as string | undefined,
      listeners: new Set<(reason?: string) => void>(),
      subscribe(listener: (reason?: string) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      cancel(reason?: string) {
        this.cancelled = true;
        this.reason = reason;
        for (const listener of this.listeners) listener(reason);
      },
    };
    const pending = pendingReadiness.execute({}, baseContext({ cancellation: token }));
    token.cancel('mid');
    resolveProject?.(READY_FIXTURE);
    const midCancel = await pending;
    expect(midCancel.errorCode).toBe('CANCELLED');

    const search = createSearchRepositoryTool({
      listSourcePaths: async () => ['src/a.ts'],
      readSourceFile: async () => 'export const a = 1;\n',
    });
    expect((await search.execute({}, baseContext({ phase: 'UNDERSTANDING' }))).errorCode).toBe(
      'INVALID_ARGS',
    );
    expect(
      (
        await search.execute(
          { query: 'export' },
          baseContext({
            phase: 'UNDERSTANDING',
            cancellation: { cancelled: true, reason: 'x', subscribe: () => () => undefined },
          }),
        )
      ).errorCode,
    ).toBe('CANCELLED');

    const read = createReadSourceFileTool({
      readSourceFile: async () => {
        throw new Error('missing');
      },
    });
    expect(
      (await read.execute({ logicalPath: 'src/a.ts' }, baseContext({ phase: 'UNDERSTANDING' })))
        .errorCode,
    ).toMatch(/READ_FAILED|FAILED|missing/i);
    expect((await read.execute({}, baseContext({ phase: 'UNDERSTANDING' }))).errorCode).toBe(
      'INVALID_ARGS',
    );

    const runner = new FakeRunner();
    const controlledTerminal = new ControlledTerminalService({
      createRunner: () => runner,
      discoverScripts: () => ({
        hasBuild: true,
        hasTest: true,
        lintScript: 'lint',
        typecheckScript: 'typecheck',
        formatScript: 'format:check',
      }),
    });
    runner.next = {
      ...runner.next,
      policyBlocked: true,
      exitCode: null,
      stdout: '',
      stderr: '',
    };
    const runTool = createRunVerificationCommandTool({ controlledTerminal });
    expect(
      (await runTool.execute({ commandId: 'npm-run-build' }, baseContext({ projectRoot: '/proj' })))
        .errorCode,
    ).toBeDefined();

    const catalog = createInspectVerificationCatalogTool({ controlledTerminal });
    expect((await catalog.execute({}, baseContext({ projectRoot: '' }))).errorCode).toBe(
      'INVALID_CONTEXT',
    );

    const sanitized = sanitizeToolStructured({
      stdout: 'secret',
      diagnosticSummary: 'ok',
      nested: { stderr: 'nope', keep: true },
    });
    for (const key of TOOL_RESULT_FORBIDDEN_KEYS) {
      expect(JSON.stringify(sanitized)).not.toContain(`"${key}"`);
    }
  });

  it('covers remaining outline/import denial and run-tool timeout-status branches', async () => {
    const { createInspectFileOutlineTool } = await import('./tools/inspect-file-outline.tool');
    const { createInspectImportsTool } = await import('./tools/inspect-imports.tool');
    const { ProjectFileSourceAccessDeniedError } = await import('../../../core/context-builder');
    const { ToolPolicyGate } = await import('./tool-policy');
    const { ToolRegistry } = await import('./tool-registry');
    const { ToolExecutor } = await import('./tool-executor');
    const { WorkspaceAuthorizationService } = await import('../workspace-authorization.service');

    const outline = createInspectFileOutlineTool({
      readSourceFile: async () => 'export function hello() {}\n',
    });
    expect(
      (
        await outline.execute(
          { logicalPath: 'src/a.ts' },
          baseContext({
            phase: 'UNDERSTANDING',
            cancellation: { cancelled: true, reason: 'x', subscribe: () => () => undefined },
          }),
        )
      ).errorCode,
    ).toBe('CANCELLED');
    expect((await outline.execute({}, baseContext({ phase: 'UNDERSTANDING' }))).errorCode).toBe(
      'INVALID_ARGS',
    );
    const outlineOk = await outline.execute(
      { logicalPath: 'src/a.ts' },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(outlineOk.errorCode).toBeUndefined();

    const deniedImports = createInspectImportsTool({
      listSourcePaths: async () => ['src/a.ts'],
      readSourceFile: async () => {
        throw new ProjectFileSourceAccessDeniedError();
      },
    });
    expect(
      (
        await deniedImports.execute(
          { logicalPath: 'src/a.ts' },
          baseContext({ phase: 'UNDERSTANDING' }),
        )
      ).errorCode,
    ).toBe('ACCESS_DENIED');

    const runner = new FakeRunner();
    runner.next = {
      ...runner.next,
      timedOut: true,
      exitCode: null,
      stdout: '',
      stderr: 'hung',
    };
    const runTool = createRunVerificationCommandTool({
      controlledTerminal: new ControlledTerminalService({
        createRunner: () => runner,
        discoverScripts: () => ({
          hasBuild: true,
          hasTest: true,
          lintScript: 'lint',
          typecheckScript: 'typecheck',
          formatScript: 'format:check',
        }),
      }),
    });
    expect(
      (await runTool.execute({ commandId: 'npm-run-build' }, baseContext({ projectRoot: '/proj' })))
        .errorCode,
    ).toBe('TIMEOUT');

    // Policy: VERIFY with wrong approvalRequirement rejected.
    const policy = new ToolPolicyGate(
      new WorkspaceAuthorizationService({
        profile: 'TRUSTED_LOCAL',
        projectId: 'builder-ai',
        principalId: 'local-operator',
      }),
    );
    const registry = new ToolRegistry(policy);
    expect(() =>
      registry.register({
        definition: {
          ...runVerificationCommandToolMinimal(),
          approvalRequirement: 'OPERATOR',
        },
        execute: async () => ({ summary: 'no' }),
      }),
    ).toThrow(/catalog-only|NONE|approval/i);

    // Executor timeout path.
    registry.register({
      definition: runVerificationCommandToolMinimal(),
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { summary: 'late' };
      },
    });
    const executor = new ToolExecutor(registry, policy);
    const timed = await executor.execute(
      { callId: 'to', toolId: 'run_verification_command', args: { commandId: 'npm-run-build' } },
      baseContext({ timeoutMs: 1 }),
    );
    expect(timed.status).toBe('TIMEOUT');
  });
});

function runVerificationCommandToolMinimal() {
  return {
    toolId: 'run_verification_command' as const,
    name: 'Run',
    description: 'd',
    inputSchema: {},
    outputSchema: {},
    capabilityClass: 'VERIFY' as const,
    readOnly: true,
    riskLevel: 'HIGH' as const,
    authorizationAction: 'PREPARE' as const,
    requiresGate2: false,
    approvalRequirement: 'NONE' as const,
    workspaceScoped: true,
    timeoutMs: 5_000,
    supportsCancellation: true,
    evidencePolicy: 'DIGEST' as const,
    auditPolicy: 'DIGEST' as const,
    allowedPhases: ['PLANNING'] as const,
  };
}

describe('B4 sanitizer and executor branch boost', () => {
  it('covers sanitizer edge branches needed for CI threshold', async () => {
    const {
      truncateToolSummary,
      sanitizeToolStructured,
      assertNoForbiddenToolResultPayload,
      digestToolStructured,
      TOOL_RESULT_FORBIDDEN_KEYS: keys,
    } = await import('./tool-result-sanitizer');
    const { TOOL_SUMMARY_MAX_CHARS } = await import('./tool-registry.types');

    expect(truncateToolSummary('short')).toBe('short');
    expect(truncateToolSummary('x'.repeat(TOOL_SUMMARY_MAX_CHARS + 10)).endsWith('…')).toBe(true);
    expect(sanitizeToolStructured(undefined)).toBeUndefined();
    expect(digestToolStructured(undefined)).toBeUndefined();
    expect(digestToolStructured({ a: 1 })).toEqual(expect.any(String));

    const deep: Record<string, unknown> = { v: 1 };
    let cursor: Record<string, unknown> = deep;
    for (let i = 0; i < 12; i += 1) {
      const next: Record<string, unknown> = { v: i };
      cursor.child = next;
      cursor = next;
    }
    const deepSanitized = sanitizeToolStructured(deep as never);
    expect(JSON.stringify(deepSanitized)).toContain('truncated-depth');

    const withLong = sanitizeToolStructured({
      long: 'y'.repeat(4_050),
      many: Array.from({ length: 120 }, (_, i) => i),
    });
    expect(withLong).toBeDefined();
    expect(JSON.stringify(withLong)).not.toContain('"stdout"');

    const huge = {
      parts: Array.from({ length: 80 }, (_, i) => ({
        i,
        text: 'z'.repeat(400),
      })),
    };
    expect(sanitizeToolStructured(huge)).toMatchObject({ truncated: true });

    expect(() => assertNoForbiddenToolResultPayload({ stdout: 'leak', keep: true })).toThrow(
      /stdout/,
    );
    expect(keys.length).toBeGreaterThan(5);
  });

  it('covers ToolExecutor reject/idempotency/throw/cancel-subscribe branches', async () => {
    const { ToolPolicyGate } = await import('./tool-policy');
    const { ToolRegistry } = await import('./tool-registry');
    const { ToolExecutor } = await import('./tool-executor');
    const { WorkspaceAuthorizationService } = await import('../workspace-authorization.service');

    const auth = new WorkspaceAuthorizationService({
      profile: 'TRUSTED_LOCAL',
      projectId: 'builder-ai',
      principalId: 'local-operator',
    });
    const policy = new ToolPolicyGate(auth);
    const registry = new ToolRegistry(policy);
    registry.register({
      definition: {
        ...runVerificationCommandToolMinimal(),
        toolId: 'inspect_verification_catalog',
        capabilityClass: 'INSPECT',
        riskLevel: 'LOW',
        authorizationAction: 'READINESS',
        auditPolicy: 'NONE',
        timeoutMs: 2_000,
      },
      execute: async () => ({ summary: 'catalog-ok', structured: { totalCount: 1 } }),
    });
    registry.register({
      definition: {
        ...runVerificationCommandToolMinimal(),
        toolId: 'run_verification_command',
        timeoutMs: 2_000,
      },
      execute: async () => {
        throw new Error('handler exploded');
      },
    });

    const executor = new ToolExecutor(registry, policy);
    expect(
      (
        await executor.execute(
          { callId: '', toolId: 'inspect_verification_catalog', args: {} },
          baseContext(),
        )
      ).status,
    ).toBe('REJECTED_BY_POLICY');
    expect(
      (await executor.execute({ callId: 'u1', toolId: 'missing_tool', args: {} }, baseContext()))
        .errorCode,
    ).toBe('UNKNOWN_TOOL');

    const first = await executor.execute(
      {
        callId: 'id1',
        toolId: 'inspect_verification_catalog',
        args: {},
        idempotencyKey: 'same',
      },
      baseContext(),
    );
    const second = await executor.execute(
      {
        callId: 'id2',
        toolId: 'inspect_verification_catalog',
        args: {},
        idempotencyKey: 'same',
      },
      baseContext(),
    );
    expect(second).toEqual(first);
    expect(first.digests).toBeUndefined();

    const exploded = await executor.execute(
      { callId: 'boom', toolId: 'run_verification_command', args: { commandId: 'npm-run-build' } },
      baseContext(),
    );
    expect(exploded.errorCode).toBe('EXECUTION_FAILED');

    // Cancel via subscribe after start.
    const slowRegistry = new ToolRegistry(policy);
    slowRegistry.register({
      definition: {
        ...runVerificationCommandToolMinimal(),
        toolId: 'inspect_verification_catalog',
        capabilityClass: 'INSPECT',
        riskLevel: 'LOW',
        authorizationAction: 'READINESS',
        timeoutMs: 5_000,
      },
      execute: async (_args, context) => {
        await new Promise<void>((resolve) => {
          const unsub = context.cancellation.subscribe(() => {
            unsub();
            resolve();
          });
        });
        return { summary: 'should-cancel' };
      },
    });
    const slowExecutor = new ToolExecutor(slowRegistry, policy);
    const token = {
      cancelled: false,
      reason: undefined as string | undefined,
      listeners: new Set<(reason?: string) => void>(),
      subscribe(listener: (reason?: string) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      cancel(reason?: string) {
        this.cancelled = true;
        this.reason = reason;
        for (const listener of this.listeners) listener(reason);
      },
    };
    const pending = slowExecutor.execute(
      { callId: 'cxl', toolId: 'inspect_verification_catalog', args: {} },
      baseContext({ cancellation: token }),
    );
    setTimeout(() => token.cancel('mid-flight'), 5);
    const cancelled = await pending;
    expect(cancelled.status).toBe('CANCELLED');
  });
});
