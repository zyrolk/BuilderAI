import { describe, expect, it } from 'vitest';

import type { FileApplyResult } from '../../../core/file-apply';
import {
  PARTIAL_APPLY_RECOVERY_STEPS,
  appliedWithVerificationFailureHeadline,
  baselineDriftGuidance,
  dependencyChangeGuidance,
  freshPrepareRequiredNotice,
  partialApplyHeadline,
  partialApplySafetyNotice,
  summarizePartialApplyOperations,
  verificationCommandFailureGuidance,
  verificationFailureCorrectionHint,
  verificationInfrastructureGuidance,
  verificationTimeoutGuidance,
} from '../operator-recovery-guidance';

describe('operator recovery guidance', () => {
  it('exposes recovery guidance strings', () => {
    expect(PARTIAL_APPLY_RECOVERY_STEPS.length).toBeGreaterThan(0);
    expect(partialApplyHeadline()).toMatch(/written to disk/i);
    expect(partialApplySafetyNotice()).toMatch(/Fresh prepare/i);
    expect(appliedWithVerificationFailureHeadline()).toMatch(/verification failed/i);
    expect(baselineDriftGuidance()).toMatch(/Baseline drift/i);
    expect(dependencyChangeGuidance()).toMatch(/npm install/i);
    expect(verificationFailureCorrectionHint()).toMatch(/Gate 2/i);
    expect(verificationTimeoutGuidance()).toMatch(/time limit/i);
    expect(verificationInfrastructureGuidance()).toMatch(/could not execute/i);
    expect(verificationCommandFailureGuidance()).toMatch(/stdout\/stderr/i);
    expect(freshPrepareRequiredNotice()).toMatch(/Fresh prepare required/i);
  });

  it('summarizes partial apply operation counts', () => {
    const applyResult: FileApplyResult = {
      schemaVersion: 1,
      status: 'PARTIALLY_APPLIED',
      createdFiles: ['a.ts'],
      updatedFiles: ['b.ts'],
      deletedFiles: ['c.ts'],
      skippedFiles: ['d.ts', 'e.ts'],
      warnings: [],
      errors: [{ code: 'FILESYSTEM_OPERATION_FAILED', message: 'failed' }],
      durationMs: 1,
      metadata: {},
    };
    expect(summarizePartialApplyOperations(applyResult)).toEqual({
      appliedCount: 3,
      failedCount: 1,
      skippedCount: 2,
    });
  });
});
