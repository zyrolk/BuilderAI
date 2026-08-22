import { describe, expect, it } from 'vitest';

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import { VerificationPolicyViolationError } from '../../../core/verification/policy';
import type { SafeVerificationExecutionResult } from '../../../infrastructure/verification/safe-verification-runner';
import {
  ControlledTerminalService,
  type ControlledTerminalRunnerPort,
} from './controlled-terminal.service';
import { CONTROLLED_TERMINAL_COMMAND_IDS } from './controlled-terminal.types';

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function success(
  overrides: Partial<SafeVerificationExecutionResult> = {},
): SafeVerificationExecutionResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    policyBlocked: false,
    stdout: 'out',
    stderr: 'err',
    stdoutLimited: false,
    stderrLimited: false,
    outputLimited: false,
    ...overrides,
  };
}

class FakeRunner implements ControlledTerminalRunnerPort {
  next: SafeVerificationExecutionResult = success();
  throws?: Error;

  async execute(): Promise<SafeVerificationExecutionResult> {
    if (this.throws !== undefined) throw this.throws;
    return this.next;
  }
}

const ALL_SCRIPTS = {
  hasBuild: true,
  hasTest: true,
  lintScript: 'lint',
  typecheckScript: 'typecheck',
  formatScript: 'format:check',
} as const;

describe('ControlledTerminalService', () => {
  it('lists catalog availability from discovered scripts', () => {
    const runner = new FakeRunner();
    const service = new ControlledTerminalService({
      createRunner: () => runner,
      discoverScripts: () => ({
        hasBuild: false,
        hasTest: true,
        lintScript: undefined,
        typecheckScript: 'type-check',
        formatScript: undefined,
      }),
    });
    const catalog = service.listCatalog('/proj');
    expect(catalog).toHaveLength(CONTROLLED_TERMINAL_COMMAND_IDS.length);
    expect(catalog.find((e) => e.commandId === 'npm-ls-omit-dev-json')?.available).toBe(true);
    expect(catalog.find((e) => e.commandId === 'npm-run-build')?.available).toBe(false);
    expect(catalog.find((e) => e.commandId === 'npm-run-test')?.available).toBe(true);
    expect(catalog.find((e) => e.commandId === 'npm-run-lint')?.available).toBe(false);
    expect(catalog.find((e) => e.commandId === 'npm-run-typecheck')?.scriptName).toBe('type-check');
    expect(catalog.find((e) => e.commandId === 'npm-run-format')?.available).toBe(false);
  });

  it('rejects unknown command ids, empty project root, and missing scripts', async () => {
    const runner = new FakeRunner();
    const service = new ControlledTerminalService({
      createRunner: () => runner,
      discoverScripts: () => ({
        hasBuild: false,
        hasTest: false,
        lintScript: undefined,
        typecheckScript: undefined,
        formatScript: undefined,
      }),
    });

    expect(
      (await service.runCommand({ commandId: 'npx', projectRoot: '/p' })).policyBlockCode,
    ).toBe('UNKNOWN_COMMAND_ID');
    expect(
      (await service.runCommand({ commandId: 'npm-run-build', projectRoot: '   ' }))
        .policyBlockCode,
    ).toBe('INVALID_PROJECT_ROOT');
    expect(
      (await service.runCommand({ commandId: 'npm-run-build', projectRoot: '/p' })).policyBlockCode,
    ).toBe('SCRIPT_UNAVAILABLE');
    expect(
      (await service.runCommand({ commandId: 'npm-run-test', projectRoot: '/p' })).policyBlockCode,
    ).toBe('SCRIPT_UNAVAILABLE');
    expect(
      (await service.runCommand({ commandId: 'npm-run-lint', projectRoot: '/p' })).policyBlockCode,
    ).toBe('SCRIPT_UNAVAILABLE');
    expect(
      (await service.runCommand({ commandId: 'npm-run-typecheck', projectRoot: '/p' }))
        .policyBlockCode,
    ).toBe('SCRIPT_UNAVAILABLE');
    expect(
      (await service.runCommand({ commandId: 'npm-run-format', projectRoot: '/p' }))
        .policyBlockCode,
    ).toBe('SCRIPT_UNAVAILABLE');
  });

  it('maps runner outcomes and truncates diagnostic summaries', async () => {
    const runner = new FakeRunner();
    const service = new ControlledTerminalService({
      createRunner: () => runner,
      discoverScripts: () => ALL_SCRIPTS,
      diagnosticSummaryMaxChars: 8,
    });

    runner.next = success({ exitCode: 0, stdout: 'ABCDEFGHIJKLMNOP', stderr: '' });
    const ok = await service.runCommand({ commandId: 'npm-run-build', projectRoot: '/p' });
    expect(ok.executionStatus).toBe('SUCCEEDED');
    expect(ok.diagnosticSummary.endsWith('…')).toBe(true);

    runner.next = success({ exitCode: 2, stdout: '', stderr: 'fail' });
    expect(
      (await service.runCommand({ commandId: 'npm-run-test', projectRoot: '/p' })).executionStatus,
    ).toBe('FAILED');

    runner.next = success({
      policyBlocked: true,
      policyBlockCode: 'FORBIDDEN_NPM_SUBCOMMAND',
      exitCode: null,
      stdout: '',
      stderr: '',
    });
    const blocked = await service.runCommand({
      commandId: 'npm-ls-omit-dev-json',
      projectRoot: '/p',
    });
    expect(blocked.executionStatus).toBe('REJECTED_BY_POLICY');
    expect(blocked.policyBlockCode).toBe('FORBIDDEN_NPM_SUBCOMMAND');

    runner.next = success({ cancelled: true, exitCode: null, stdout: '', stderr: '' });
    expect(
      (await service.runCommand({ commandId: 'npm-run-lint', projectRoot: '/p' })).executionStatus,
    ).toBe('CANCELLED');

    runner.next = success({ timedOut: true, exitCode: null, stdout: '', stderr: '' });
    expect(
      (await service.runCommand({ commandId: 'npm-run-typecheck', projectRoot: '/p' }))
        .executionStatus,
    ).toBe('TIMEOUT');

    runner.next = success({ exitCode: 0, stdout: '', stderr: '' });
    expect(
      (await service.runCommand({ commandId: 'npm-run-format', projectRoot: '/p' }))
        .executionStatus,
    ).toBe('SUCCEEDED');
  });

  it('honours pre-cancel and runner construction policy violations', async () => {
    const runner = new FakeRunner();
    const service = new ControlledTerminalService({
      createRunner: () => {
        throw new VerificationPolicyViolationError(
          'BUILDERAI_ROOT_FORBIDDEN',
          'Verification cannot run against the BuilderAI repository root.',
        );
      },
      discoverScripts: () => ALL_SCRIPTS,
    });

    const cancelled = await service.runCommand({
      commandId: 'npm-run-build',
      projectRoot: '/p',
      cancellation: { cancelled: true, reason: 'stop', subscribe: () => () => undefined },
    });
    expect(cancelled.executionStatus).toBe('CANCELLED');

    const confined = await service.runCommand({ commandId: 'npm-run-build', projectRoot: '/p' });
    expect(confined.policyBlockCode).toBe('BUILDERAI_ROOT_FORBIDDEN');

    const rethrow = new ControlledTerminalService({
      createRunner: () => {
        throw new Error('boom');
      },
      discoverScripts: () => ALL_SCRIPTS,
    });
    await expect(
      rethrow.runCommand({ commandId: 'npm-run-build', projectRoot: '/p' }),
    ).rejects.toThrow(/boom/);

    // Keep FakeRunner referenced for type stability in suite.
    expect(runner).toBeInstanceOf(Object);
    expect(neverCancelled().cancelled).toBe(false);
  });

  it('uses maxChars<=1 truncation branch for diagnostic summaries', async () => {
    const runner = new FakeRunner();
    const service = new ControlledTerminalService({
      createRunner: () => runner,
      discoverScripts: () => ALL_SCRIPTS,
      diagnosticSummaryMaxChars: 1,
    });
    runner.next = success({ stdout: 'abcdef', stderr: 'xyz' });
    const result = await service.runCommand({ commandId: 'npm-run-build', projectRoot: '/p' });
    expect(result.diagnosticSummary).toBe('…');
  });
});
