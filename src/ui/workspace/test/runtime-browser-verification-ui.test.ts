import { describe, expect, it } from 'vitest';

import type { RuntimeBrowserVerificationReport } from '../../../core/runtime-verification';
import {
  formatBrowserVerificationStatus,
  formatRuntimeServerStatus,
  runtimeBrowserVerificationFailed,
} from '../../../ui/workspace/runtime-browser-verification-display';

const SAMPLE_REPORT: RuntimeBrowserVerificationReport = {
  schemaVersion: 1,
  status: 'FAILED',
  durationMs: 100,
  metadata: {},
  server: {
    descriptorId: 'npm-run-dev',
    status: 'READY',
    startupDurationMs: 50,
    url: 'http://127.0.0.1:3000/',
  },
  browser: {
    status: 'FAILED',
    durationMs: 50,
    routes: [
      {
        path: '/',
        status: 'CONSOLE_ERROR',
        durationMs: 40,
        consoleErrors: [{ level: 'error', message: 'boom' }],
        pageExceptions: [],
        failedRequests: [],
      },
    ],
    consoleErrorCount: 1,
    pageExceptionCount: 0,
    failedRequestCount: 0,
  },
};

describe('runtime browser verification UI display', () => {
  it('formats runtime and browser statuses for operators', () => {
    expect(formatRuntimeServerStatus('READY')).toBe('Ready');
    expect(formatBrowserVerificationStatus('FAILED')).toBe('Failed');
    expect(runtimeBrowserVerificationFailed(SAMPLE_REPORT)).toBe(true);
    expect(runtimeBrowserVerificationFailed(undefined)).toBe(false);
  });
});
