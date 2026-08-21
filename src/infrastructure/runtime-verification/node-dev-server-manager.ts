import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type {
  RuntimeServerManagerPort,
  RuntimeServerStartRequest,
} from '../../core/runtime-verification/ports';
import type { RuntimeServerEvidence } from '../../core/runtime-verification';
import {
  buildAllowlistedVerificationEnvironment,
  containsForbiddenVerificationEnvironmentKey,
  rejectForbiddenNpmArguments,
  rejectForbiddenShellInvocation,
} from '../../core/verification/policy';
import { validateRuntimeServerDescriptor } from '../../core/runtime-verification/policy';
import { BoundedStreamCapture } from '../verification/bounded-output-capture';
import {
  forceTerminateProcessTree,
  terminateProcessTree,
} from '../verification/process-tree-termination';
import { buildLocalhostUrl } from './localhost-port-allocation';

const READINESS_POLL_INTERVAL_MS = 500;

export class NodeDevServerManager implements RuntimeServerManagerPort {
  private child: ChildProcess | undefined;
  private stdoutCapture = new BoundedStreamCapture(1_000_000);
  private stderrCapture = new BoundedStreamCapture(1_000_000);

  async start(request: RuntimeServerStartRequest): Promise<RuntimeServerEvidence> {
    const startedAt = Date.now();
    validateRuntimeServerDescriptor(request.descriptor, request.projectRoot);
    if (request.cancellation?.cancelled) {
      return cancelledEvidence(request.descriptor.id, startedAt);
    }
    const projectRoot = path.resolve(request.projectRoot);
    const port = request.port;
    const environment = buildDevServerEnvironment(port, request.host);
    const forbidden = containsForbiddenVerificationEnvironmentKey(environment);
    if (forbidden !== undefined) {
      return policyBlockedEvidence(request.descriptor.id, startedAt, 'FORBIDDEN_ENVIRONMENT_KEY');
    }
    const invocation = resolveNpmInvocation(request.descriptor.fixedArguments);
    rejectForbiddenShellInvocation(invocation.executable, invocation.arguments);
    rejectForbiddenNpmArguments(request.descriptor.fixedArguments);
    this.stdoutCapture = new BoundedStreamCapture(request.outputLimitBytes);
    this.stderrCapture = new BoundedStreamCapture(request.outputLimitBytes);
    this.child = spawn(invocation.executable, [...invocation.arguments], {
      cwd: projectRoot,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout?.on('data', (chunk) => this.stdoutCapture.append(chunk));
    this.child.stderr?.on('data', (chunk) => this.stderrCapture.append(chunk));
    let earlyExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    this.child.once('exit', (code, signal) => {
      earlyExit = { code, signal };
    });
    const readiness = await waitForServerReady({
      url: buildLocalhostUrl(port, '/'),
      timeoutMs: request.startupTimeoutMs,
      cancellation: request.cancellation,
      isProcessAlive: () => this.child !== undefined && earlyExit === undefined,
    });
    const startupDurationMs = Date.now() - startedAt;
    if (request.cancellation?.cancelled) {
      await this.shutdown();
      return cancelledEvidence(request.descriptor.id, startupDurationMs);
    }
    if (earlyExit !== undefined) {
      await this.shutdown();
      return {
        descriptorId: request.descriptor.id,
        status: 'PROCESS_FAILED',
        port,
        startupDurationMs,
        diagnostic: buildDiagnostic(this.stdoutCapture, this.stderrCapture),
      };
    }
    if (readiness.timedOut) {
      await this.shutdown();
      return {
        descriptorId: request.descriptor.id,
        status: 'TIMEOUT',
        port,
        startupDurationMs,
        diagnostic: buildDiagnostic(this.stdoutCapture, this.stderrCapture),
      };
    }
    if (!readiness.ready) {
      return {
        descriptorId: request.descriptor.id,
        status: 'NOT_READY',
        port,
        startupDurationMs,
        diagnostic: buildDiagnostic(this.stdoutCapture, this.stderrCapture),
      };
    }
    return {
      descriptorId: request.descriptor.id,
      status: 'READY',
      url: buildLocalhostUrl(port, '/'),
      port,
      startupDurationMs,
      httpStatus: readiness.httpStatus,
      httpDurationMs: readiness.httpDurationMs,
      diagnostic: buildDiagnostic(this.stdoutCapture, this.stderrCapture),
    };
  }

  async shutdown(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (child === undefined) return;
    terminateProcessTree(child);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        forceTerminateProcessTree(child);
        resolve();
      }, 5_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.once('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

async function waitForServerReady(input: {
  readonly url: string;
  readonly timeoutMs: number;
  readonly cancellation?: { readonly cancelled: boolean };
  readonly isProcessAlive: () => boolean;
}): Promise<{
  readonly ready: boolean;
  readonly timedOut: boolean;
  readonly httpStatus?: number;
  readonly httpDurationMs?: number;
}> {
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    if (input.cancellation?.cancelled || !input.isProcessAlive()) {
      return { ready: false, timedOut: false };
    }
    const probe = await probeHttp(input.url, Math.min(2_000, deadline - Date.now()));
    if (probe.reachable) {
      return {
        ready: true,
        timedOut: false,
        httpStatus: probe.status,
        httpDurationMs: probe.durationMs,
      };
    }
    await sleep(READINESS_POLL_INTERVAL_MS);
  }
  return { ready: false, timedOut: true };
}

async function probeHttp(
  url: string,
  timeoutMs: number,
): Promise<{
  readonly reachable: boolean;
  readonly status?: number;
  readonly durationMs?: number;
}> {
  if (timeoutMs <= 0) return { reachable: false };
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { Accept: 'text/html,application/json,*/*' },
    });
    return {
      reachable: true,
      status: response.status,
      durationMs: Date.now() - startedAt,
    };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

function buildDevServerEnvironment(port: number, host: string): NodeJS.ProcessEnv {
  return {
    ...buildAllowlistedVerificationEnvironment(),
    PORT: String(port),
    HOST: host,
    HOSTNAME: host,
  };
}

function resolveNpmInvocation(arguments_: readonly string[]): {
  readonly executable: string;
  readonly arguments: readonly string[];
} {
  if (process.platform !== 'win32') return { executable: 'npm', arguments: arguments_ };
  const installed = path.resolve(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (existsSync(installed)) {
    return { executable: process.execPath, arguments: [installed, ...arguments_] };
  }
  return { executable: 'npm.cmd', arguments: arguments_ };
}

function buildDiagnostic(stdout: BoundedStreamCapture, stderr: BoundedStreamCapture) {
  const stdoutSnapshot = stdout.snapshot();
  const stderrSnapshot = stderr.snapshot();
  const truncated = stdoutSnapshot.limited || stderrSnapshot.limited;
  return {
    ...(stdoutSnapshot.text.length === 0
      ? {}
      : { stdoutExcerpt: stdoutSnapshot.text.slice(0, 4_096) }),
    ...(stderrSnapshot.text.length === 0
      ? {}
      : { stderrExcerpt: stderrSnapshot.text.slice(0, 4_096) }),
    truncated,
  };
}

function cancelledEvidence(descriptorId: string, durationMs: number): RuntimeServerEvidence {
  return { descriptorId, status: 'CANCELLED', startupDurationMs: durationMs };
}

function policyBlockedEvidence(
  descriptorId: string,
  durationMs: number,
  code: string,
): RuntimeServerEvidence {
  return {
    descriptorId,
    status: 'POLICY_BLOCKED',
    startupDurationMs: durationMs,
    policyBlockCode: code,
  };
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
