import { describe, expect, it } from 'vitest';

import type { RuntimeBrowserVerificationReport } from '../../../core/runtime-verification';
import {
  formatBrowserVerificationStatus,
  formatRuntimeServerStatus,
  runtimeBrowserVerificationFailed,
} from '../runtime-browser-verification-display';

describe('runtime browser verification display', () => {
  it('formats all runtime server statuses', () => {
    expect(formatRuntimeServerStatus('READY')).toBe('Ready');
    expect(formatRuntimeServerStatus('NOT_READY')).toBe('Not ready');
    expect(formatRuntimeServerStatus('PROCESS_FAILED')).toBe('Failed');
    expect(formatRuntimeServerStatus('TIMEOUT')).toBe('Timeout');
    expect(formatRuntimeServerStatus('CANCELLED')).toBe('Cancelled');
    expect(formatRuntimeServerStatus('POLICY_BLOCKED')).toBe('Policy blocked');
    expect(formatRuntimeServerStatus('UNAVAILABLE')).toBe('Unavailable');
  });

  it('formats all browser verification statuses', () => {
    expect(formatBrowserVerificationStatus('PASSED')).toBe('Passed');
    expect(formatBrowserVerificationStatus('FAILED')).toBe('Failed');
    expect(formatBrowserVerificationStatus('TIMEOUT')).toBe('Timeout');
    expect(formatBrowserVerificationStatus('CANCELLED')).toBe('Cancelled');
    expect(formatBrowserVerificationStatus('UNAVAILABLE')).toBe('Unavailable');
    expect(formatBrowserVerificationStatus('POLICY_BLOCKED')).toBe('Policy blocked');
  });

  it('detects failed runtime browser verification reports', () => {
    expect(runtimeBrowserVerificationFailed(undefined)).toBe(false);
    const base: RuntimeBrowserVerificationReport = {
      schemaVersion: 1,
      status: 'PASSED',
      server: {
        descriptorId: 'next-dev',
        status: 'READY',
        port: 3000,
        startupDurationMs: 100,
      },
      browser: {
        status: 'PASSED',
        durationMs: 50,
        routes: [],
        consoleErrorCount: 0,
        pageExceptionCount: 0,
        failedRequestCount: 0,
      },
      durationMs: 150,
      metadata: {},
    };
    expect(runtimeBrowserVerificationFailed(base)).toBe(false);
    expect(runtimeBrowserVerificationFailed({ ...base, status: 'FAILED' })).toBe(true);
    expect(runtimeBrowserVerificationFailed({ ...base, status: 'PARTIAL' })).toBe(true);
    expect(runtimeBrowserVerificationFailed({ ...base, status: 'TIMEOUT' })).toBe(true);
  });
});
