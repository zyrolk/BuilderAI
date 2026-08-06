import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { VerificationReport } from '../../../core/verification';
import { ResultPanel } from '../result-panel';
import { APPLY_RESULT, VERIFICATION_REPORT } from './workspace.fixture';

function failedReportWithDiagnostic(): VerificationReport {
  return {
    ...VERIFICATION_REPORT,
    status: 'FAILED',
    stages: VERIFICATION_REPORT.stages.map((stage) =>
      stage.stage === 'TEST_VALIDATION'
        ? {
            ...stage,
            status: 'FAILED' as const,
            errors: [{ code: 'TEST_FAILED', message: 'Test validation exited unsuccessfully.' }],
            diagnostic: {
              commandLabel: 'npm test',
              exitCode: 1,
              stderrExcerpt:
                'FAIL tests/supplierOrder.test.ts\nExpected PROCESSING but received CANCELLED',
              truncated: false,
            },
          }
        : stage,
    ),
    errors: [
      {
        stage: 'TEST_VALIDATION',
        code: 'TEST_FAILED',
        message: 'Test validation exited unsuccessfully.',
      },
    ],
  };
}

describe('CP9 verification diagnostics UI', () => {
  it('scenario 2 — failed test stage shows stderr excerpt and command metadata', () => {
    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={failedReportWithDiagnostic()}
      />,
    );
    expect(screen.getByText(/Command: npm test/i)).toBeInTheDocument();
    expect(screen.getByText(/Exit code: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/supplierOrder.test.ts/i)).toBeInTheDocument();
  });

  it('scenario 5 — successful verification stays compact without diagnostic dumps', () => {
    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={VERIFICATION_REPORT}
      />,
    );
    expect(screen.queryByText(/Stdout excerpt/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stderr excerpt/i)).not.toBeInTheDocument();
  });

  it('scenario 6 — failed stage shows stdout excerpt and truncation metadata', () => {
    const report: VerificationReport = {
      ...failedReportWithDiagnostic(),
      stages: failedReportWithDiagnostic().stages.map((stage) =>
        stage.stage === 'TEST_VALIDATION'
          ? {
              ...stage,
              diagnostic: {
                commandLabel: 'npm run build',
                exitCode: 2,
                stdoutExcerpt: 'Compiled with warnings',
                stderrExcerpt: 'Module not found',
                truncated: true,
                omittedBytes: 512,
              },
            }
          : stage,
      ),
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(screen.getByText(/Stdout excerpt/i)).toBeInTheDocument();
    expect(screen.getByText(/Compiled with warnings/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Diagnostic output was truncated \(512 bytes omitted\)/i),
    ).toBeInTheDocument();
  });

  it('scenario 7 — truncated diagnostics without omitted byte count still show note', () => {
    const report: VerificationReport = {
      ...failedReportWithDiagnostic(),
      stages: failedReportWithDiagnostic().stages.map((stage) =>
        stage.stage === 'TEST_VALIDATION'
          ? {
              ...stage,
              diagnostic: {
                stderrExcerpt: 'Build failed',
                truncated: true,
              },
            }
          : stage,
      ),
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(screen.getByText(/Diagnostic output was truncated\./i)).toBeInTheDocument();
  });

  it('scenario 8 — timeout failures show timeout-specific operator guidance', () => {
    const report: VerificationReport = {
      ...failedReportWithDiagnostic(),
      stages: failedReportWithDiagnostic().stages.map((stage) =>
        stage.stage === 'TEST_VALIDATION'
          ? {
              ...stage,
              errors: [
                {
                  code: 'VERIFICATION_COMMAND_TIMEOUT',
                  message: 'Verification command timed out.',
                },
              ],
            }
          : stage,
      ),
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(screen.getByText(/exceeded the configured time limit/i)).toBeInTheDocument();
  });

  it('scenario 9 — infrastructure failures show infrastructure operator guidance', () => {
    const report: VerificationReport = {
      ...failedReportWithDiagnostic(),
      stages: failedReportWithDiagnostic().stages.map((stage) =>
        stage.stage === 'TEST_VALIDATION'
          ? {
              ...stage,
              errors: [
                {
                  code: 'STAGE_EXECUTION_FAILED',
                  message: 'Verification stage could not run.',
                },
              ],
            }
          : stage,
      ),
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(
      screen.getByText(/could not execute the verification stage reliably/i),
    ).toBeInTheDocument();
  });

  it('scenario 10a — empty diagnostic payload on failed stage renders no diagnostic section', () => {
    const report: VerificationReport = {
      ...failedReportWithDiagnostic(),
      stages: failedReportWithDiagnostic().stages.map((stage) =>
        stage.stage === 'TEST_VALIDATION'
          ? {
              ...stage,
              diagnostic: {
                truncated: false,
              },
            }
          : stage,
      ),
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(screen.queryByLabelText('Verification diagnostics')).not.toBeInTheDocument();
  });

  it('scenario 10b — report-level timeout category drives stage guidance without stage timeout code', () => {
    const report: VerificationReport = {
      schemaVersion: 1,
      status: 'FAILED',
      stages: [
        {
          stage: 'TEST_VALIDATION',
          status: 'FAILED',
          warnings: [],
          errors: [],
          durationMs: 1,
          metadata: {},
        },
      ],
      warnings: [],
      errors: [
        {
          stage: 'TEST_VALIDATION',
          code: 'VERIFICATION_COMMAND_TIMEOUT',
          message: 'Timed out.',
        },
      ],
      durationMs: 1,
      metadata: {},
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(screen.getByText(/exceeded the configured time limit/i)).toBeInTheDocument();
  });

  it('scenario 10c — report-level infrastructure category drives stage guidance without stage infra code', () => {
    const report: VerificationReport = {
      schemaVersion: 1,
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'FAILED',
          warnings: [],
          errors: [],
          durationMs: 1,
          metadata: {},
        },
      ],
      warnings: [],
      errors: [
        {
          stage: 'BUILD_VALIDATION',
          code: 'STAGE_CONTRACT_VIOLATION',
          message: 'Contract violation.',
        },
      ],
      durationMs: 1,
      metadata: {},
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(
      screen.getByText(/could not execute the verification stage reliably/i),
    ).toBeInTheDocument();
  });

  it('scenario 10 — multiple failure categories render in the classification list', () => {
    const report: VerificationReport = {
      schemaVersion: 1,
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'FAILED',
          warnings: [],
          errors: [{ code: 'BUILD_FAILED', message: 'Build failed.' }],
          durationMs: 1,
          metadata: {},
        },
        {
          stage: 'TEST_VALIDATION',
          status: 'FAILED',
          warnings: [],
          errors: [{ code: 'TEST_FAILED', message: 'Tests failed.' }],
          durationMs: 1,
          metadata: {},
        },
      ],
      warnings: [],
      errors: [],
      durationMs: 2,
      metadata: {},
    };

    render(
      <ResultPanel
        activeTab="VERIFICATION_REPORT"
        onTabChange={() => undefined}
        applyResult={APPLY_RESULT}
        verificationReport={report}
      />,
    );

    expect(screen.getByText(/Failure classification/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Build Failed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Test Failed/i).length).toBeGreaterThan(0);
  });
});
