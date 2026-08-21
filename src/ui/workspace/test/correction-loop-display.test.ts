import { describe, expect, it } from 'vitest';

import { CORRECTION_LOOP_SCHEMA_VERSION } from '../../../application/workspace/correction-loop/correction-loop.types';
import type { CorrectionLoopSession } from '../../../application/workspace/correction-loop';
import {
  buildCorrectionPreparedPayload,
  buildCorrectionStartPayload,
  correctionSessionHeadline,
  formatCorrectionState,
  isCorrectionAwaitingApproval,
  isCorrectionTerminal,
} from '../correction-loop-display';

const SESSION: CorrectionLoopSession = {
  schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
  workflowId: 'wf-1',
  state: 'CORRECTION_WAITING_FOR_APPROVAL',
  attempt: 2,
  maximumAttempts: 3,
  startedAt: '2026-08-20T10:00:00.000Z',
  deadlineAt: '2026-08-20T13:00:00.000Z',
  attemptHistory: [],
};

describe('correction loop display', () => {
  it('formats correction states for operators', () => {
    expect(formatCorrectionState('CORRECTION_WAITING_FOR_APPROVAL')).toBe('Waiting For Approval');
    expect(formatCorrectionState('CORRECTION_PASSED')).toBe('Passed');
  });

  it('builds correction session headline', () => {
    expect(correctionSessionHeadline(SESSION)).toBe('Correction attempt 2/3');
  });

  it('detects awaiting approval and terminal states', () => {
    expect(isCorrectionAwaitingApproval(SESSION)).toBe(true);
    expect(isCorrectionAwaitingApproval(undefined)).toBe(false);
    expect(isCorrectionAwaitingApproval({ ...SESSION, state: 'CORRECTION_PREPARING' })).toBe(false);
    expect(isCorrectionTerminal(undefined)).toBe(false);
    expect(isCorrectionTerminal(SESSION)).toBe(false);
    for (const state of [
      'CORRECTION_PASSED',
      'CORRECTION_FAILED',
      'CORRECTION_EXHAUSTED',
      'CORRECTION_CANCELLED',
      'CORRECTION_BLOCKED',
      'CORRECTION_LOOP_DETECTED',
    ] as const) {
      expect(isCorrectionTerminal({ ...SESSION, state })).toBe(true);
    }
  });

  it('builds correction start payload with optional fields', () => {
    const minimal = buildCorrectionStartPayload(
      { applyResult: { status: 'APPLIED' } as never },
      'wf-1',
    );
    expect(minimal).toEqual({ workflowId: 'wf-1', applyResult: { status: 'APPLIED' } });

    const full = buildCorrectionStartPayload(
      {
        applyResult: { status: 'APPLIED' } as never,
        verificationReport: { status: 'FAILED' } as never,
        runtimeBrowserVerificationReport: { status: 'FAILED' } as never,
        sourcePreparationId: 'prep-1',
        priorRequestSummary: 'Fix tests',
      },
      'wf-1',
      'Original task',
    );
    expect(full).toMatchObject({
      workflowId: 'wf-1',
      verificationReport: { status: 'FAILED' },
      runtimeBrowserVerificationReport: { status: 'FAILED' },
      sourcePreparationId: 'prep-1',
      priorRequestSummary: 'Fix tests',
      originalTaskSummary: 'Original task',
    });
  });

  it('builds correction prepared payload', () => {
    expect(
      buildCorrectionPreparedPayload('wf-1', 'prep-1', { changeSet: { operations: [] } } as never),
    ).toEqual({
      workflowId: 'wf-1',
      preparationId: 'prep-1',
      changePlan: { changeSet: { operations: [] } },
    });
  });
});
