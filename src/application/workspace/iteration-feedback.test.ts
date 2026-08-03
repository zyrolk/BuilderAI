import { createOperationId } from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { VerificationReport } from '../../core/verification';
import {
  buildIterationFeedbackFromCompletion,
  extractIterationPathHints,
  normalizeIterationFeedback,
  serializedIterationFeedbackLength,
} from './iteration-feedback.service';
import { ITERATION_FEEDBACK_LIMITS } from './iteration-feedback.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

const APPLIED_RESULT: FileApplyResult = {
  schemaVersion: 1,
  status: 'APPLIED',
  createdFiles: ['src/a.ts'],
  updatedFiles: ['src/b.ts'],
  deletedFiles: [],
  skippedFiles: [],
  warnings: [],
  errors: [],
  durationMs: 1,
  metadata: {},
};

const FAILED_VERIFICATION: VerificationReport = {
  schemaVersion: 1,
  status: 'FAILED',
  stages: [
    {
      stage: 'BUILD_VALIDATION',
      status: 'FAILED',
      warnings: [],
      errors: [{ code: 'BUILD_FAILED', message: 'TypeScript compilation failed.' }],
      durationMs: 2,
      metadata: { 'exit-code': 1 },
    },
  ],
  warnings: [],
  errors: [
    { code: 'BUILD_FAILED', message: 'TypeScript compilation failed.', stage: 'BUILD_VALIDATION' },
  ],
  durationMs: 3,
  metadata: {},
};

const PARTIALLY_APPLIED: FileApplyResult = {
  schemaVersion: 1,
  status: 'PARTIALLY_APPLIED',
  createdFiles: ['src/created.ts'],
  updatedFiles: ['src/updated.ts'],
  deletedFiles: [],
  skippedFiles: ['src/skipped.ts'],
  warnings: [],
  errors: [
    {
      code: 'FILESYSTEM_OPERATION_FAILED',
      message: 'Could not update skipped path.',
      logicalPath: 'src/skipped.ts',
      operationId: createOperationId('UPDATE_FILE', 'src/skipped.ts'),
    },
  ],
  durationMs: 2,
  metadata: {},
};

describe('IterationFeedback normalization', () => {
  it('builds bounded feedback for APPLIED plus verification FAILED correction', () => {
    const feedback = buildIterationFeedbackFromCompletion(
      { applyResult: APPLIED_RESULT, verificationReport: FAILED_VERIFICATION },
      { priorRequestSummary: 'Add feature X.' },
    );

    expect(feedback.kind).toBe('CORRECTION');
    expect(feedback.apply.status).toBe('APPLIED');
    expect(feedback.verification?.status).toBe('FAILED');
    expect(feedback.verification?.topErrors[0]?.code).toBe('BUILD_FAILED');
    expect(serializedIterationFeedbackLength(feedback)).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS,
    );
  });

  it('distinguishes successful paths from skipped paths for PARTIALLY_APPLIED', () => {
    const feedback = buildIterationFeedbackFromCompletion({ applyResult: PARTIALLY_APPLIED });

    expect(feedback.apply.status).toBe('PARTIALLY_APPLIED');
    expect(feedback.apply.createdPaths).toEqual(['src/created.ts']);
    expect(feedback.apply.updatedPaths).toEqual(['src/updated.ts']);
    expect(feedback.apply.skippedPaths).toEqual(['src/skipped.ts']);
    expect(feedback.apply.errors[0]?.logicalPath).toBe('src/skipped.ts');
  });

  it('rejects raw stdout, stderr, and absolute paths in finding messages', () => {
    expect(() =>
      normalizeIterationFeedback({
        schemaVersion: 1,
        kind: 'CORRECTION',
        apply: {
          status: 'FAILED',
          createdPaths: [],
          updatedPaths: [],
          deletedPaths: [],
          skippedPaths: [],
          errors: [{ code: 'BUILD_FAILED', message: 'npm ERR! stdout captured at /Users/dev/app' }],
          warnings: [],
        },
      }),
    ).not.toThrow();

    const feedback = normalizeIterationFeedback({
      schemaVersion: 1,
      kind: 'CORRECTION',
      apply: {
        status: 'FAILED',
        createdPaths: [],
        updatedPaths: [],
        deletedPaths: [],
        skippedPaths: [],
        errors: [{ code: 'BUILD_FAILED', message: 'npm ERR! stdout captured at /Users/dev/app' }],
        warnings: [],
      },
    });
    expect(feedback.apply.errors).toEqual([]);
  });

  it('allows safe P1-8 scalar metadata on verification stages', () => {
    const feedback = buildIterationFeedbackFromCompletion({
      applyResult: APPLIED_RESULT,
      verificationReport: FAILED_VERIFICATION,
    });

    expect(feedback.verification?.stages[0]?.metadata).toEqual({ 'exit-code': 1 });
  });

  it('rejects tampered schemaVersion and oversized prior summaries', () => {
    expect(() =>
      normalizeIterationFeedback({ schemaVersion: 2, kind: 'CORRECTION', apply: APPLIED_RESULT }),
    ).toThrow(WorkspaceRuntimeError);

    const feedback = normalizeIterationFeedback({
      schemaVersion: 1,
      kind: 'CORRECTION',
      priorRequestSummary: 'x'.repeat(600),
      apply: APPLIED_RESULT,
    });
    expect(feedback.priorRequestSummary?.length).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_PRIOR_REQUEST_SUMMARY,
    );
  });

  it('caps path hints at eight unique safe paths', () => {
    const feedback = normalizeIterationFeedback({
      schemaVersion: 1,
      kind: 'CORRECTION',
      apply: {
        status: 'PARTIALLY_APPLIED',
        createdPaths: Array.from({ length: 12 }, (_, index) => `src/file-${index}.ts`),
        updatedPaths: ['src/extra.ts'],
        deletedPaths: [],
        skippedPaths: [],
        errors: [],
        warnings: [],
      },
    });

    expect(extractIterationPathHints(feedback)).toHaveLength(
      ITERATION_FEEDBACK_LIMITS.MAX_PATH_HINTS,
    );
  });

  it('produces deterministic serialized feedback for identical inputs', () => {
    const input = {
      applyResult: APPLIED_RESULT,
      verificationReport: FAILED_VERIFICATION,
    };
    const first = buildIterationFeedbackFromCompletion(input, {
      priorRequestSummary: 'Fix build.',
    });
    const second = buildIterationFeedbackFromCompletion(input, {
      priorRequestSummary: 'Fix build.',
    });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
