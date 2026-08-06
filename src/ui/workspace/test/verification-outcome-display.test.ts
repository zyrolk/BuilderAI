import { describe, expect, it } from 'vitest';

import { createOperationId, type ProjectChangePlan } from '../../../core/change-planner';
import type { FileApplyResult } from '../../../core/file-apply';
import type { VerificationReport } from '../../../core/verification';
import { isCorrectionEligible } from '../workspace.types';
import {
  changePlanTouchesLockfile,
  changePlanTouchesPackageJson,
  formatFailureCategory,
  hasAppliedChanges,
  hasBaselineDriftApplyFailure,
  isAppliedWithVerificationFailure,
  isPartialApplyOutcome,
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

const CHANGE_PLAN_TEMPLATE: ProjectChangePlan = {
  schemaVersion: 1,
  source: { responsePackageSchemaVersion: 1, executionId: 'x' },
  changeSet: { operations: [] },
  summary: {
    filesCreated: [],
    filesUpdated: [],
    filesDeleted: [],
    totalOperations: 0,
    warnings: [],
  },
  risks: [],
  warnings: [],
  metadata: {},
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

  it('returns an empty summary for passed or missing verification reports', () => {
    expect(summarizeVerificationFailures(undefined)).toEqual({
      categories: [],
      failedStages: [],
      primaryCategory: undefined,
      primaryLabel: undefined,
    });
    expect(
      summarizeVerificationFailures({
        schemaVersion: 1,
        status: 'PASSED',
        stages: [],
        warnings: [],
        errors: [],
        durationMs: 1,
        metadata: {},
      }).primaryCategory,
    ).toBeUndefined();
  });

  it('collects multiple failure categories across failed stages', () => {
    const report: VerificationReport = {
      schemaVersion: 1,
      status: 'FAILED',
      stages: [
        reportWithFailedStage('BUILD_VALIDATION', 'BUILD_FAILED').stages[0]!,
        reportWithFailedStage('TEST_VALIDATION', 'TEST_FAILED').stages[0]!,
      ],
      warnings: [],
      errors: [],
      durationMs: 2,
      metadata: {},
    };

    const summary = summarizeVerificationFailures(report);
    expect(summary.categories).toEqual(expect.arrayContaining(['BUILD_FAILED', 'TEST_FAILED']));
    expect(summary.failedStages).toEqual(
      expect.arrayContaining(['BUILD_VALIDATION', 'TEST_VALIDATION']),
    );
  });

  it('maps unknown stage failures ending in _FAILED to infrastructure failures', () => {
    const report: VerificationReport = {
      schemaVersion: 1,
      status: 'FAILED',
      stages: [
        {
          stage: 'DEPENDENCY_VALIDATION',
          status: 'FAILED',
          warnings: [],
          errors: [{ code: 'CUSTOM_STAGE_FAILED', message: 'Custom stage failed.' }],
          durationMs: 1,
          metadata: {},
        },
      ],
      warnings: [],
      errors: [],
      durationMs: 1,
      metadata: {},
    };

    expect(summarizeVerificationFailures(report).categories).toContain(
      'VERIFICATION_INFRASTRUCTURE_FAILURE',
    );
  });

  it('collects timeout and infrastructure codes from report-level errors', () => {
    const infrastructureReport: VerificationReport = {
      schemaVersion: 1,
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'PASSED',
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
          code: 'DEPENDENCY_VALIDATION_FAILED',
          message: 'Dependency validation failed.',
        },
      ],
      durationMs: 1,
      metadata: {},
    };
    const timeoutReport: VerificationReport = {
      ...infrastructureReport,
      errors: [
        {
          stage: 'TEST_VALIDATION',
          code: 'VERIFICATION_COMMAND_TIMEOUT',
          message: 'Verification timed out.',
        },
      ],
    };

    expect(summarizeVerificationFailures(infrastructureReport).categories).toContain(
      'VERIFICATION_INFRASTRUCTURE_FAILURE',
    );
    expect(summarizeVerificationFailures(timeoutReport).categories).toContain(
      'VERIFICATION_COMMAND_TIMEOUT',
    );
  });

  it('formats failure categories for operator-readable labels', () => {
    expect(formatFailureCategory('TEST_FAILED')).toBe('Test Failed');
  });

  it('detects applied, partial, drift, and lockfile guidance helpers', () => {
    expect(hasAppliedChanges(undefined)).toBe(false);
    expect(
      hasAppliedChanges({
        ...APPLIED,
        createdFiles: [],
        updatedFiles: [],
        deletedFiles: [],
      }),
    ).toBe(false);
    expect(hasAppliedChanges(APPLIED)).toBe(true);
    expect(isPartialApplyOutcome(undefined)).toBe(false);
    expect(isPartialApplyOutcome(PARTIAL)).toBe(true);
    expect(changePlanTouchesPackageJson(undefined)).toBe(false);
    expect(changePlanTouchesLockfile(undefined)).toBe(false);
    expect(hasBaselineDriftApplyFailure(undefined)).toBe(false);
    expect(
      hasBaselineDriftApplyFailure({
        ...APPLIED,
        status: 'FAILED',
        errors: [{ code: 'BASELINE_CONTENT_DRIFT', message: 'Drift', logicalPath: 'src/a.ts' }],
      }),
    ).toBe(true);
    expect(isAppliedWithVerificationFailure(undefined, undefined)).toBe(false);
    expect(
      isAppliedWithVerificationFailure(
        APPLIED,
        reportWithFailedStage('TEST_VALIDATION', 'TEST_FAILED'),
      ),
    ).toBe(true);
    expect(
      isAppliedWithVerificationFailure(APPLIED, {
        ...reportWithFailedStage('TEST_VALIDATION', 'TEST_FAILED'),
        status: 'PARTIALLY_PASSED',
      }),
    ).toBe(true);
    expect(
      changePlanTouchesPackageJson({
        ...CHANGE_PLAN_TEMPLATE,
        changeSet: {
          operations: [
            {
              operationId: createOperationId('UPDATE_FILE', 'apps/web/package.json'),
              kind: 'UPDATE_FILE',
              logicalPath: 'apps/web/package.json',
              artifactType: 'SOURCE_FILE',
              description: 'Nested package.json',
              sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
              sourceSizeBytes: 1,
              content: '{}',
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      changePlanTouchesLockfile({
        ...CHANGE_PLAN_TEMPLATE,
        changeSet: {
          operations: [
            {
              operationId: createOperationId('UPDATE_FILE', 'package-lock.json'),
              kind: 'UPDATE_FILE',
              logicalPath: 'package-lock.json',
              artifactType: 'SOURCE_FILE',
              description: 'Lockfile update',
              sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
              sourceSizeBytes: 1,
              content: '{}',
            },
          ],
        },
        summary: {
          filesCreated: [],
          filesUpdated: ['package-lock.json'],
          filesDeleted: [],
          totalOperations: 1,
          warnings: [],
        },
      }),
    ).toBe(true);
  });
});
