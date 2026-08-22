import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ChangePlannerService } from '../../../core/change-planner';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { SafeVerificationExecutionResult } from '../../../infrastructure/verification/safe-verification-runner';
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
import type { ToolExecutionContext } from './tool-registry.types';
import {
  createInspectVerificationCatalogTool,
  inspectVerificationCatalogToolDefinition,
} from './tools/inspect-verification-catalog.tool';
import {
  createRunVerificationCommandTool,
  runVerificationCommandToolDefinition,
} from './tools/run-verification-command.tool';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function baseContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    runId: 'run-b4-handlers',
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

describe('B4 tool handlers direct coverage', () => {
  it('covers cancel, cancelled-from-runner, and definition exports', async () => {
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

    const runTool = createRunVerificationCommandTool({ controlledTerminal });
    const catalogTool = createInspectVerificationCatalogTool({ controlledTerminal });

    const cancelledRun = await runTool.execute(
      { commandId: 'npm-run-build' },
      baseContext({
        cancellation: { cancelled: true, reason: 'stop', subscribe: () => () => undefined },
      }),
    );
    expect(cancelledRun.errorCode).toBe('CANCELLED');

    const cancelledCatalog = await catalogTool.execute(
      {},
      baseContext({
        cancellation: { cancelled: true, reason: 'stop', subscribe: () => () => undefined },
      }),
    );
    expect(cancelledCatalog.errorCode).toBe('CANCELLED');

    runner.next = {
      ...runner.next,
      cancelled: true,
      exitCode: null,
      stdout: '',
      stderr: '',
    };
    const runnerCancelled = await runTool.execute(
      { commandId: 'npm-run-build' },
      baseContext({ projectRoot: '/proj' }),
    );
    expect(runnerCancelled.errorCode).toBe('CANCELLED');

    expect(runVerificationCommandToolDefinition().toolId).toBe('run_verification_command');
    expect(inspectVerificationCatalogToolDefinition().toolId).toBe('inspect_verification_catalog');
  });

  it('covers createControlledTerminalService default SafeVerificationRunner factory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'builderai-b4-factory-'));
    try {
      await writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'x', private: true, scripts: {} }),
        'utf8',
      );
      const service = createControlledTerminalService({
        stageTimeoutMs: 500,
        outputLimitBytes: 1024,
      });
      const result = await service.runCommand({
        commandId: 'npm-ls-omit-dev-json',
        projectRoot: root,
      });
      expect(['SUCCEEDED', 'FAILED', 'TIMEOUT', 'CANCELLED', 'REJECTED_BY_POLICY']).toContain(
        result.executionStatus,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exercises B2 inspect_imports through B4 registry composition', async () => {
    const source = {
      listSourcePaths: async () => ['src/a.ts', 'src/b.ts'],
      readSourceFile: async (logicalPath: string) => {
        if (logicalPath === 'src/a.ts') return "import { b } from './b';\nexport const a = 1;\n";
        if (logicalPath === 'src/b.ts') return 'export const b = 2;\n';
        throw new Error(`missing ${logicalPath}`);
      },
    };

    const runner = new FakeRunner();
    const controlledTerminal = new ControlledTerminalService({
      createRunner: () => runner,
      discoverScripts: () => ({
        hasBuild: true,
        hasTest: false,
        lintScript: undefined,
        typecheckScript: undefined,
        formatScript: undefined,
      }),
    });

    let idSeq = 0;
    const { executor } = createB4TerminalRegistry({
      authorization: new WorkspaceAuthorizationService({
        profile: 'TRUSTED_LOCAL',
        projectId: 'builder-ai',
        principalId: 'local-operator',
      }),
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
      editProposals: new EditProposalService({
        changePlanner: new ChangePlannerService(),
        preparePort: {
          prepareFromResponsePackage: async () => {
            throw new Error('unused');
          },
        },
        clock: { now: () => new Date('2026-08-21T18:00:00.000Z') },
        ids: {
          generate: () => {
            idSeq += 1;
            return `imp-${String(idSeq).padStart(3, '0')}`;
          },
        },
        expectedBaselineDigest: 'b',
        readBaselineDigest: async () => 'b',
      }),
      controlledTerminal,
    });

    const ok = await executor.execute(
      {
        callId: 'imp1',
        toolId: 'inspect_imports',
        args: { logicalPath: 'src/a.ts' },
      },
      baseContext({ phase: 'UNDERSTANDING', projectRoot: '/proj' }),
    );
    expect(ok.status).toBe('SUCCEEDED');

    const badArgs = await executor.execute(
      { callId: 'imp2', toolId: 'inspect_imports', args: {} },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(badArgs.errorCode).toBe('INVALID_ARGS');

    const traversal = await executor.execute(
      {
        callId: 'imp3',
        toolId: 'inspect_imports',
        args: { logicalPath: '../secret.ts' },
      },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(traversal.errorCode).toBe('INVALID_ARGS');

    const cancelled = await executor.execute(
      {
        callId: 'imp4',
        toolId: 'inspect_imports',
        args: { logicalPath: 'src/a.ts' },
      },
      baseContext({
        phase: 'UNDERSTANDING',
        cancellation: { cancelled: true, reason: 'x', subscribe: () => () => undefined },
      }),
    );
    expect(cancelled.status).toBe('CANCELLED');

    const missing = await executor.execute(
      {
        callId: 'imp5',
        toolId: 'inspect_imports',
        args: { logicalPath: 'src/missing.ts' },
      },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(missing.errorCode).toBe('IMPORT_INSPECT_FAILED');

    const search = await executor.execute(
      { callId: 's1', toolId: 'search_repository', args: { query: 'export' } },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(search.status).toBe('SUCCEEDED');

    const read = await executor.execute(
      { callId: 'r1', toolId: 'read_source_file', args: { logicalPath: 'src/a.ts' } },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(read.status).toBe('SUCCEEDED');

    const related = await executor.execute(
      {
        callId: 'rel1',
        toolId: 'find_related_files',
        args: { logicalPath: 'src/a.ts' },
      },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(related.status).toBe('SUCCEEDED');

    const outline = await executor.execute(
      {
        callId: 'o1',
        toolId: 'inspect_file_outline',
        args: { logicalPath: 'src/a.ts' },
      },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(outline.status).toBe('SUCCEEDED');

    const contextHits = await executor.execute(
      {
        callId: 'ctx1',
        toolId: 'retrieve_relevant_context',
        args: { goal: 'export const' },
      },
      baseContext({ phase: 'UNDERSTANDING' }),
    );
    expect(contextHits.status).toBe('SUCCEEDED');
  });
});
