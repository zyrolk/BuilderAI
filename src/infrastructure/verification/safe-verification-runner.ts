import { spawn } from 'node:child_process';

import type { ExecutionCancellationToken } from '../../core/execution-engine';
import type { VerificationCommandDescriptor } from '../../core/verification/policy';
import {
  buildAllowlistedVerificationEnvironment,
  containsForbiddenVerificationEnvironmentKey,
} from '../../core/verification/policy';
import {
  assertProjectRootConfinement,
  rejectForbiddenNpmArguments,
  rejectForbiddenShellInvocation,
  validateCommandDescriptorAgainstPolicy,
  VerificationPolicyViolationError,
  type VerificationExecutionPolicyConfiguration,
} from '../../core/verification/policy';
import { BoundedStreamCapture } from './bounded-output-capture';
import { forceTerminateProcessTree, terminateProcessTree } from './process-tree-termination';
import { resolveNpmInvocation } from './resolve-npm-invocation';

export interface SafeVerificationExecutionResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly policyBlocked: boolean;
  readonly policyBlockCode?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutLimited: boolean;
  readonly stderrLimited: boolean;
  readonly outputLimited: boolean;
}

export interface SafeVerificationRunnerConfiguration extends VerificationExecutionPolicyConfiguration {
  readonly hardKillGraceMs?: number;
}

export class SafeVerificationRunner {
  private readonly resolvedProjectRoot: string;

  constructor(private readonly configuration: SafeVerificationRunnerConfiguration) {
    this.resolvedProjectRoot = assertProjectRootConfinement(
      configuration.projectRoot,
      configuration.builderAiRoot,
    );
  }

  async execute(
    descriptor: VerificationCommandDescriptor,
    options: {
      readonly cancellation?: ExecutionCancellationToken;
      readonly remainingWorkflowMs?: number;
    } = {},
  ): Promise<SafeVerificationExecutionResult> {
    try {
      validateCommandDescriptorAgainstPolicy(descriptor, this.configuration);
      const timeoutMs = resolveStageTimeout(descriptor.timeoutMs, options.remainingWorkflowMs);
      if (timeoutMs <= 0) {
        return unavailableResult('WORKFLOW_DEADLINE_EXCEEDED');
      }
      if (options.cancellation?.cancelled) {
        return cancelledResult();
      }
      const invocation = resolveNpmInvocation(descriptor.fixedArguments);
      rejectForbiddenShellInvocation(invocation.executable, invocation.arguments);
      rejectForbiddenNpmArguments(descriptor.fixedArguments);
      const environment = buildAllowlistedVerificationEnvironment();
      const forbidden = containsForbiddenVerificationEnvironmentKey(environment);
      if (forbidden !== undefined) {
        throw new VerificationPolicyViolationError(
          'FORBIDDEN_ENVIRONMENT_KEY',
          `Forbidden environment key "${forbidden}" cannot be passed to verification.`,
        );
      }
      return await this.spawnBounded(invocation, environment, timeoutMs, options.cancellation);
    } catch (error: unknown) {
      if (error instanceof VerificationPolicyViolationError) {
        return {
          exitCode: null,
          signal: null,
          timedOut: false,
          cancelled: false,
          policyBlocked: true,
          policyBlockCode: error.code,
          stdout: '',
          stderr: '',
          stdoutLimited: false,
          stderrLimited: false,
          outputLimited: false,
        };
      }
      throw error;
    }
  }

  private spawnBounded(
    invocation: { readonly executable: string; readonly arguments: readonly string[] },
    environment: NodeJS.ProcessEnv,
    timeoutMs: number,
    cancellation?: ExecutionCancellationToken,
  ): Promise<SafeVerificationExecutionResult> {
    return new Promise((resolve, reject) => {
      const stdoutCapture = new BoundedStreamCapture(this.configuration.outputLimitBytes);
      const stderrCapture = new BoundedStreamCapture(this.configuration.outputLimitBytes);
      const child = spawn(invocation.executable, [...invocation.arguments], {
        cwd: this.resolvedProjectRoot,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      let hardKillTimer: ReturnType<typeof setTimeout> | undefined;
      const settle = (result: SafeVerificationExecutionResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (hardKillTimer !== undefined) clearTimeout(hardKillTimer);
        unsubscribeCancellation();
        resolve(result);
      };
      const unsubscribeCancellation =
        cancellation?.subscribe(() => {
          cancelled = true;
          terminateProcessTree(child);
          hardKillTimer = setTimeout(
            () => forceTerminateProcessTree(child),
            this.configuration.hardKillGraceMs ?? 5_000,
          );
          hardKillTimer.unref();
        }) ?? (() => undefined);
      child.stdout.on('data', (chunk: Buffer | string) => stdoutCapture.append(chunk));
      child.stderr.on('data', (chunk: Buffer | string) => stderrCapture.append(chunk));
      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (hardKillTimer !== undefined) clearTimeout(hardKillTimer);
        unsubscribeCancellation();
        reject(error);
      });
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateProcessTree(child);
        hardKillTimer = setTimeout(
          () => forceTerminateProcessTree(child),
          this.configuration.hardKillGraceMs ?? 5_000,
        );
        hardKillTimer.unref();
      }, timeoutMs);
      timeoutTimer.unref();
      child.once('close', (exitCode, signal) => {
        const stdout = stdoutCapture.snapshot();
        const stderr = stderrCapture.snapshot();
        const outputLimited = stdout.limited || stderr.limited;
        settle({
          exitCode,
          signal,
          timedOut,
          cancelled,
          policyBlocked: false,
          stdout: stdout.text,
          stderr: stderr.text,
          stdoutLimited: stdout.limited,
          stderrLimited: stderr.limited,
          outputLimited,
        });
      });
    });
  }
}

function resolveStageTimeout(stageTimeoutMs: number, remainingWorkflowMs?: number): number {
  if (remainingWorkflowMs === undefined) return stageTimeoutMs;
  return Math.min(stageTimeoutMs, remainingWorkflowMs);
}

function cancelledResult(): SafeVerificationExecutionResult {
  return {
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
  };
}

function unavailableResult(code: string): SafeVerificationExecutionResult {
  return {
    exitCode: null,
    signal: null,
    timedOut: false,
    cancelled: false,
    policyBlocked: true,
    policyBlockCode: code,
    stdout: '',
    stderr: '',
    stdoutLimited: false,
    stderrLimited: false,
    outputLimited: false,
  };
}
