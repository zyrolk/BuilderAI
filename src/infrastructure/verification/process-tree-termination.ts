import { spawn } from 'node:child_process';

/**
 * Attempts to terminate a child process and its descendants where the OS allows it.
 * Windows tree termination is best-effort via taskkill /T; Unix uses direct signals.
 */
export function terminateProcessTree(child: {
  readonly pid?: number;
  kill: (signal?: NodeJS.Signals) => boolean;
}): void {
  if (child.pid === undefined) {
    child.kill('SIGTERM');
    return;
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

export function forceTerminateProcessTree(child: {
  readonly pid?: number;
  kill: (signal?: NodeJS.Signals) => boolean;
}): void {
  if (child.pid === undefined) {
    child.kill('SIGKILL');
    return;
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}
