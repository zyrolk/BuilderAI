import { describe, expect, it } from 'vitest';

import { CHANGE_PLAN } from '../../../ui/workspace/test/workspace.fixture';
import { digestChangePlan } from './correction-diagnostic.service';
import { detectCorrectionLoop, listChangedPaths } from './correction-loop-detection';
import type { CorrectionDiagnostic } from './correction-loop.types';

function diagnostic(
  overrides: Partial<Pick<CorrectionDiagnostic, 'failureCategory' | 'diagnosticDigest'>> = {},
): CorrectionDiagnostic {
  return {
    schemaVersion: 1,
    workflowId: 'wf-1',
    attempt: 1,
    failureStage: 'BUILD_VALIDATION',
    failureCategory: 'BUILD_FAILURE',
    summary: 'Build failed',
    affectedRoutes: [],
    affectedFiles: ['src/a.ts'],
    diagnostics: [],
    evidenceReferences: [],
    diagnosticDigest: 'diag-a',
    sufficientEvidence: true,
    metadata: {},
    ...overrides,
  };
}

describe('detectCorrectionLoop branches', () => {
  it('continues when there is no prior attempt', () => {
    expect(
      detectCorrectionLoop({
        diagnostic: diagnostic(),
        changePlan: CHANGE_PLAN,
        attemptHistory: [],
      }),
    ).toEqual({ kind: 'CONTINUE', classification: 'CONTINUE' });
  });

  it('continues with NEW_FAILURE when plan is absent and failure changes', () => {
    expect(
      detectCorrectionLoop({
        diagnostic: diagnostic({ failureCategory: 'TEST_FAILURE', diagnosticDigest: 'diag-b' }),
        attemptHistory: [
          {
            attempt: 1,
            failureCategory: 'BUILD_FAILURE',
            diagnosticDigest: 'diag-a',
            changedPaths: ['src/a.ts'],
            completedAt: '2026-08-20T12:00:00.000Z',
          },
        ],
      }),
    ).toEqual({ kind: 'CONTINUE', classification: 'NEW_FAILURE' });
  });

  it('continues when plan is absent and failure is unchanged', () => {
    expect(
      detectCorrectionLoop({
        diagnostic: diagnostic(),
        attemptHistory: [
          {
            attempt: 1,
            failureCategory: 'BUILD_FAILURE',
            diagnosticDigest: 'diag-a',
            changedPaths: ['src/a.ts'],
            completedAt: '2026-08-20T12:00:00.000Z',
          },
        ],
      }),
    ).toEqual({ kind: 'CONTINUE', classification: 'CONTINUE' });
  });

  it('detects duplicate plan loop', () => {
    const planDigest = digestChangePlan(CHANGE_PLAN);
    expect(
      detectCorrectionLoop({
        diagnostic: diagnostic({ failureCategory: 'TEST_FAILURE', diagnosticDigest: 'diag-b' }),
        changePlan: CHANGE_PLAN,
        attemptHistory: [
          {
            attempt: 1,
            failureCategory: 'BUILD_FAILURE',
            diagnosticDigest: 'diag-a',
            changePlanDigest: planDigest,
            changedPaths: ['src/a.ts'],
            completedAt: '2026-08-20T12:00:00.000Z',
          },
        ],
      }),
    ).toEqual({
      kind: 'LOOP_DETECTED',
      classification: 'SAME_PLAN',
      reason: 'Proposed correction matches a previous correction ChangePlan.',
    });
  });

  it('continues for a new failure with a new plan', () => {
    expect(
      detectCorrectionLoop({
        diagnostic: diagnostic({ failureCategory: 'TEST_FAILURE', diagnosticDigest: 'diag-b' }),
        changePlan: CHANGE_PLAN,
        attemptHistory: [
          {
            attempt: 1,
            failureCategory: 'BUILD_FAILURE',
            diagnosticDigest: 'diag-a',
            changePlanDigest: `${digestChangePlan(CHANGE_PLAN)}-other`,
            changedPaths: ['src/a.ts'],
            completedAt: '2026-08-20T12:00:00.000Z',
          },
        ],
      }),
    ).toEqual({ kind: 'CONTINUE', classification: 'NEW_FAILURE' });
  });

  it('lists unique sorted changed paths', () => {
    const paths = listChangedPaths(CHANGE_PLAN);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));
  });
});
