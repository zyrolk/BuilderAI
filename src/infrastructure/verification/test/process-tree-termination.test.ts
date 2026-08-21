import { describe, expect, it, vi } from 'vitest';

import { forceTerminateProcessTree, terminateProcessTree } from '../process-tree-termination';

describe('process tree termination', () => {
  it('falls back to child.kill when pid is undefined', () => {
    const kill = vi.fn().mockReturnValue(true);
    terminateProcessTree({ kill });
    expect(kill).toHaveBeenCalledWith('SIGTERM');

    kill.mockClear();
    forceTerminateProcessTree({ kill });
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('uses platform-specific termination when pid is defined', () => {
    const kill = vi.fn().mockReturnValue(true);
    expect(() => terminateProcessTree({ pid: process.pid, kill })).not.toThrow();
    expect(() => forceTerminateProcessTree({ pid: process.pid, kill })).not.toThrow();
  });

  it('falls back to child.kill when process group kill fails', () => {
    if (process.platform === 'win32') return;
    const kill = vi.fn().mockReturnValue(true);
    const originalKill = process.kill;
    process.kill = vi.fn(() => {
      throw new Error('no process group');
    }) as typeof process.kill;
    try {
      terminateProcessTree({ pid: 99_999, kill });
      expect(kill).toHaveBeenCalledWith('SIGTERM');
      forceTerminateProcessTree({ pid: 99_999, kill });
      expect(kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      process.kill = originalKill;
    }
  });
});
