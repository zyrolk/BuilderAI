import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ExecutionCancellationToken } from '../../core/execution-engine';
import { BoundedStreamCapture } from '../verification/bounded-output-capture';
import {
  forceTerminateProcessTree,
  terminateProcessTree,
} from '../verification/process-tree-termination';
import {
  assertControlledGitRepositoryRoot,
  assertSafeControlledGitArguments,
  buildControlledGitEnvironment,
  ControlledGitPolicyViolationError,
  prepareWriteIsolationArtifacts,
} from './controlled-git-environment';

export interface ControlledGitRunnerDescriptor {
  readonly id: string;
  readonly fixedArguments: readonly string[];
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly neutralizeHooks: boolean;
}

export interface ControlledGitExecutionResult {
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

export interface ControlledGitRunnerConfiguration {
  readonly repositoryRoot: string;
  readonly builderAiRoot?: string;
  readonly hardKillGraceMs?: number;
  readonly gitExecutable?: string;
}

/**
 * Dedicated Controlled Git runner (ADR-041).
 * Fixed descriptors only — not SafeVerificationRunner, not a generic shell.
 */
export class ControlledGitRunner {
  private readonly resolvedRepositoryRoot: string;

  constructor(private readonly configuration: ControlledGitRunnerConfiguration) {
    this.resolvedRepositoryRoot = assertControlledGitRepositoryRoot(
      configuration.repositoryRoot,
      configuration.builderAiRoot,
    );
  }

  async execute(
    descriptor: ControlledGitRunnerDescriptor,
    options: {
      readonly cancellation?: ExecutionCancellationToken;
    } = {},
  ): Promise<ControlledGitExecutionResult> {
    try {
      assertSafeControlledGitArguments(
        descriptor.id,
        descriptor.fixedArguments,
        this.resolvedRepositoryRoot,
      );
      if (options.cancellation?.cancelled) {
        return cancelledResult();
      }

      let hooksPath: string | undefined;
      let isolatedConfigDir: string | undefined;
      if (descriptor.neutralizeHooks) {
        const isolation = await prepareWriteIsolationArtifacts();
        hooksPath = isolation.hooksPath;
        isolatedConfigDir = isolation.isolatedConfigDir;
      }

      const environment = buildControlledGitEnvironment({ hooksPath, isolatedConfigDir });
      const executable = resolveGitExecutable(this.configuration.gitExecutable);
      return await this.spawnBounded(
        executable,
        descriptor.fixedArguments,
        environment,
        descriptor.timeoutMs,
        descriptor.outputLimitBytes,
        options.cancellation,
      );
    } catch (error: unknown) {
      if (error instanceof ControlledGitPolicyViolationError) {
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
    executable: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
    timeoutMs: number,
    outputLimitBytes: number,
    cancellation?: ExecutionCancellationToken,
  ): Promise<ControlledGitExecutionResult> {
    return new Promise((resolve, reject) => {
      const stdoutCapture = new BoundedStreamCapture(outputLimitBytes);
      const stderrCapture = new BoundedStreamCapture(outputLimitBytes);
      const child = spawn(executable, [...args], {
        cwd: this.resolvedRepositoryRoot,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      let hardKillTimer: ReturnType<typeof setTimeout> | undefined;

      const settle = (result: ControlledGitExecutionResult): void => {
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
          outputLimited: stdout.limited || stderr.limited,
        });
      });
    });
  }
}

function resolveGitExecutable(configured?: string): string {
  if (configured !== undefined && configured.trim().length > 0) {
    const candidate = path.resolve(configured.trim());
    if (!existsSync(candidate)) {
      throw new ControlledGitPolicyViolationError(
        'GIT_EXECUTABLE_MISSING',
        'Configured Git executable does not exist.',
      );
    }
    return candidate;
  }
  return process.platform === 'win32' ? 'git.exe' : 'git';
}

function cancelledResult(): ControlledGitExecutionResult {
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
