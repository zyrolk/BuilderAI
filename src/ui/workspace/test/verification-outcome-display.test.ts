import { describe, expect, it } from 'vitest';

import { createOperationId, type ProjectChangePlan } from '../../../core/change-planner';
import type { FileApplyResult } from '../../../core/file-apply';
import type { VerificationReport } from '../../../core/verification';
import { isCorrectionEligible } from '../workspace.types';
import {
  changePlanTouchesPackageJson,
  summarizeVerificationFailures,
} from '../verification-outcome-display';

const APPLIED: FileApplyResult = {
  schemaVersion: 1,
  status: 'APPLIED',
  createdFiles: ['src/a.ts'],
  updatedFiles: [],
  deletedFiles: [],
  skippedFiles: [],
  warnings: [],
  errors: [],
  durationMs: 1,
  metadata: {},
};

const PARTIAL: FileApplyResult = {
  ...APPLIED,
  status: 'PARTIALLY_APPLIED',
  skippedFiles: ['src/b.ts'],
  errors: [{ code: 'FILESYSTEM_OPERATION_FAILED', message: 'Failed', logicalPath: 'src/b.ts' }],
};

function reportWithFailedStage(
  stage: VerificationReport['stages'][number]['stage'],
  code: string,
): VerificationReport {
  return {
    schemaVersion: 1,
    status: 'FAILED',
    stages: [
      {
        stage,
        status: 'FAILED',
        warnings: [],
        errors: [{ code, message: 'Stage failed.' }],
        durationMs: 1,
        metadata: { 'exit-code': 1 },
      },
    ],
    warnings: [],
    errors: [{ stage, code, message: 'Stage failed.' }],
    durationMs: 1,
    metadata: {},
  };
}

describe('verification outcome display', () => {
  it('classifies build, test, lint, and typecheck failures', () => {
    expect(
      summarizeVerificationFailures(reportWithFailedStage('BUILD_VALIDATION', 'BUILD_FAILED'))
        .primaryCategory,
    ).toBe('BUILD_FAILED');
    expect(
      summarizeVerificationFailures(reportWithFailedStage('TEST_VALIDATION', 'TEST_FAILED'))
        .primaryCategory,
    ).toBe('TEST_FAILED');
    expect(
      summarizeVerificationFailures(reportWithFailedStage('LINT_VALIDATION', 'LINT_FAILED'))
        .primaryCategory,
    ).toBe('LINT_FAILED');
    expect(
      summarizeVerificationFailures(
        reportWithFailedStage('TYPECHECK_VALIDATION', 'TYPECHECK_FAILED'),
      ).primaryCategory,
    ).toBe('TYPECHECK_FAILED');
  });

  it('classifies command timeout and infrastructure failures', () => {
    expect(
      summarizeVerificationFailures(
        reportWithFailedStage('BUILD_VALIDATION', 'VERIFICATION_COMMAND_TIMEOUT'),
      ).categories,
    ).toContain('VERIFICATION_COMMAND_TIMEOUT');
    expect(
      summarizeVerificationFailures(
        reportWithFailedStage('BUILD_VALIDATION', 'STAGE_EXECUTION_FAILED'),
      ).categories,
    ).toContain('VERIFICATION_INFRASTRUCTURE_FAILURE');
  });

  it('does not offer correction for PARTIALLY_APPLIED', () => {
    expect(
      isCorrectionEligible({
        applyResult: PARTIAL,
        verificationReport: reportWithFailedStage('TEST_VALIDATION', 'TEST_FAILED'),
      }),
    ).toBe(false);
  });

  it('offers correction for APPLIED + verification failure', () => {
    expect(
      isCorrectionEligible({
        applyResult: APPLIED,
        verificationReport: reportWithFailedStage('TEST_VALIDATION', 'TEST_FAILED'),
      }),
    ).toBe(true);
  });

  it('detects package.json dependency guidance', () => {
    const plan: ProjectChangePlan = {
      schemaVersion: 1,
      source: { responsePackageSchemaVersion: 1, executionId: 'x' },
      changeSet: {
        operations: [
          {
            operationId: createOperationId('UPDATE_FILE', 'package.json'),
            kind: 'UPDATE_FILE',
            logicalPath: 'package.json',
            artifactType: 'SOURCE_FILE',
            description: 'Add dependency',
            sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
            sourceSizeBytes: 1,
            content: '{}',
          },
        ],
      },
      summary: {
        filesCreated: [],
        filesUpdated: ['package.json'],
        filesDeleted: [],
        totalOperations: 1,
        warnings: [],
      },
      risks: [],
      warnings: [],
      metadata: {},
    };
    expect(changePlanTouchesPackageJson(plan)).toBe(true);
  });
});
