import { describe, expect, it } from 'vitest';

import type { VerificationReport } from '../../core/verification';
import { buildVerificationFailureInvestigationRequest } from './verification-failure-investigation';

const FAILED_REPORT: VerificationReport = {
  schemaVersion: 1,
  status: 'FAILED',
  stages: [
    {
      stage: 'TEST_VALIDATION',
      status: 'FAILED',
      warnings: [],
      errors: [{ code: 'TEST_FAILED', message: 'Test validation exited unsuccessfully.' }],
      durationMs: 2,
      metadata: { 'exit-code': 1 },
      diagnostic: {
        commandDescriptorId: 'npm-run-test',
        exitCode: 1,
        stderrExcerpt: 'FAIL tests/supplierOrder.test.ts',
        truncated: false,
      },
    },
  ],
  warnings: [],
  errors: [
    {
      stage: 'TEST_VALIDATION',
      code: 'TEST_FAILED',
      message: 'Test validation exited unsuccessfully.',
    },
  ],
  durationMs: 3,
  metadata: {},
};

describe('verification-failure-investigation', () => {
  it('builds bounded investigation request from failed verification diagnostics', () => {
    const request = buildVerificationFailureInvestigationRequest({
      report: FAILED_REPORT,
      priorRequestSummary: 'Fix supplier cancellation tests.',
    });
    expect(request).toContain('supplierOrder.test.ts');
    expect(request).toContain('Current repository source evidence has higher authority');
    expect(request.length).toBeLessThanOrEqual(4_000);
  });

  it('omits prior request section when summary is blank or absent', () => {
    const withoutSummary = buildVerificationFailureInvestigationRequest({ report: FAILED_REPORT });
    const withBlankSummary = buildVerificationFailureInvestigationRequest({
      report: FAILED_REPORT,
      priorRequestSummary: '   ',
    });

    expect(withoutSummary).not.toContain('Prior request:');
    expect(withBlankSummary).not.toContain('Prior request:');
  });

  it('includes stdout, exit code, and truncation markers when present', () => {
    const report: VerificationReport = {
      ...FAILED_REPORT,
      stages: [
        {
          ...FAILED_REPORT.stages[0]!,
          diagnostic: {
            commandDescriptorId: 'npm-run-build',
            exitCode: 2,
            stdoutExcerpt: 'Compiled with warnings',
            stderrExcerpt: 'Module not found',
            truncated: true,
          },
        },
      ],
    };

    const request = buildVerificationFailureInvestigationRequest({ report });
    expect(request).toContain('Command descriptor: npm-run-build');
    expect(request).toContain('Exit code: 2');
    expect(request).toContain('Stdout excerpt (TEST_VALIDATION): Compiled with warnings');
    expect(request).toContain('Stderr excerpt (TEST_VALIDATION): Module not found');
    expect(request).toContain('Diagnostic output was truncated before investigation handoff.');
  });

  it('skips diagnostic formatting when stage diagnostics are absent', () => {
    const report: VerificationReport = {
      ...FAILED_REPORT,
      stages: [
        {
          ...FAILED_REPORT.stages[0]!,
          diagnostic: undefined,
        },
      ],
    };

    const request = buildVerificationFailureInvestigationRequest({ report });
    expect(request).toContain('Error: TEST_FAILED');
    expect(request).not.toContain('Command:');
    expect(request).not.toContain('Stdout excerpt');
  });

  it('supports diagnostics with only stdout populated', () => {
    const report: VerificationReport = {
      ...FAILED_REPORT,
      stages: [
        {
          ...FAILED_REPORT.stages[0]!,
          diagnostic: {
            stdoutExcerpt: 'Build succeeded with warnings',
            truncated: false,
          },
        },
      ],
    };

    const request = buildVerificationFailureInvestigationRequest({ report });
    expect(request).toContain('Stdout excerpt (TEST_VALIDATION): Build succeeded with warnings');
    expect(request).not.toContain('Exit code:');
    expect(request).not.toContain('Command:');
  });
});
