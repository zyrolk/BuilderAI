import { describe, expect, it } from 'vitest';

import { VerificationEngineService } from '..';
import {
  createAppliedResult,
  createDeterministicClock,
  createPortHarness,
} from './verification.fixture';

const FAILED_STAGE = {
  status: 'FAILED',
  warnings: [{ code: 'LOCAL_WARNING', message: 'Local cache was stale' }],
  errors: [{ code: 'BUILD_FAILED', message: 'Compilation failed' }],
  metadata: { exit: 1 },
} as const;

describe('verification status and failure isolation', () => {
  it('derives PARTIALLY_PASSED when at least one stage passes and one fails', async () => {
    const harness = createPortHarness({ BUILD_VALIDATION: FAILED_STAGE });

    const report = await new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    ).verify(createAppliedResult());

    expect(report.status).toBe('PARTIALLY_PASSED');
    expect(report.errors).toEqual([
      { stage: 'BUILD_VALIDATION', code: 'BUILD_FAILED', message: 'Compilation failed' },
    ]);
    expect(report.warnings).toEqual([
      { stage: 'BUILD_VALIDATION', code: 'LOCAL_WARNING', message: 'Local cache was stale' },
    ]);
    expect(harness.calls).toHaveLength(7);
  });

  it('derives FAILED only when every stage fails', async () => {
    const harness = createPortHarness({
      PROJECT_VALIDATION: FAILED_STAGE,
      DEPENDENCY_VALIDATION: FAILED_STAGE,
      BUILD_VALIDATION: FAILED_STAGE,
      TEST_VALIDATION: FAILED_STAGE,
      LINT_VALIDATION: FAILED_STAGE,
      TYPECHECK_VALIDATION: FAILED_STAGE,
      FORMAT_VALIDATION: FAILED_STAGE,
    });

    const report = await new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    ).verify(createAppliedResult());

    expect(report.status).toBe('FAILED');
    expect(report.errors).toHaveLength(7);
  });

  it('contains thrown port failures and continues the remaining pipeline', async () => {
    const harness = createPortHarness({
      DEPENDENCY_VALIDATION: new Error('secret adapter detail'),
    });

    const report = await new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    ).verify(createAppliedResult());

    expect(harness.calls).toHaveLength(7);
    expect(report.stages[1]).toMatchObject({
      stage: 'DEPENDENCY_VALIDATION',
      status: 'FAILED',
      errors: [
        { code: 'STAGE_EXECUTION_FAILED', message: 'The verification port failed to complete.' },
      ],
    });
    expect(JSON.stringify(report)).not.toContain('secret adapter detail');
  });

  it('turns malformed port output into a contract failure and continues', async () => {
    const harness = createPortHarness({
      PROJECT_VALIDATION: { status: 'PASSED', warnings: [], errors: [] },
    });

    const report = await new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    ).verify(createAppliedResult());

    expect(report.stages[0]).toMatchObject({
      status: 'FAILED',
      errors: [
        {
          code: 'STAGE_CONTRACT_VIOLATION',
          message: 'The verification port returned an invalid result.',
        },
      ],
    });
    expect(harness.calls).toHaveLength(7);
  });
});
