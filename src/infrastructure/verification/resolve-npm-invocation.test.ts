import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { VerificationPolicyViolationError } from '../../core/verification/policy';
import { resolveNpmInvocation } from './resolve-npm-invocation';

describe('resolveNpmInvocation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('never returns a .cmd executable on win32', () => {
    if (process.platform !== 'win32') {
      const invocation = resolveNpmInvocation(['run', 'test']);
      expect(invocation.executable).toBe('npm');
      expect(invocation.arguments).toEqual(['run', 'test']);
      return;
    }

    const invocation = resolveNpmInvocation(['run', 'build']);
    expect(invocation.executable.toLowerCase().endsWith('.cmd')).toBe(false);
    expect(path.basename(invocation.executable).toLowerCase()).toBe('node.exe');
    expect(invocation.arguments[0]?.replace(/\\/g, '/')).toMatch(/npm\/bin\/npm-cli\.js$/);
    expect(invocation.arguments.slice(1)).toEqual(['run', 'build']);
  });

  it('throws NPM_INVOCATION_UNAVAILABLE instead of falling back to npm.cmd', () => {
    if (process.platform !== 'win32') return;

    const isolated = mkdtempSync(path.join(tmpdir(), 'builderai-npm-resolve-'));
    const fakeNodeDir = path.join(isolated, 'helpers');
    mkdirSync(fakeNodeDir, { recursive: true });
    const fakeNode = path.join(fakeNodeDir, 'node.exe');
    writeFileSync(fakeNode, '');

    vi.spyOn(process, 'execPath', 'get').mockReturnValue(fakeNode);
    vi.stubEnv('PATH', fakeNodeDir);
    vi.stubEnv('ProgramFiles', path.join(isolated, 'missing-pf'));
    vi.stubEnv('ProgramFiles(x86)', path.join(isolated, 'missing-pf86'));
    vi.stubEnv('LOCALAPPDATA', path.join(isolated, 'missing-local'));

    expect(() => resolveNpmInvocation(['run', 'test'])).toThrow(VerificationPolicyViolationError);
    try {
      resolveNpmInvocation(['run', 'test']);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(VerificationPolicyViolationError);
      expect((error as VerificationPolicyViolationError).code).toBe('NPM_INVOCATION_UNAVAILABLE');
    }
  });
});
