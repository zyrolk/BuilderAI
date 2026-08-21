import { describe, expect, it, vi } from 'vitest';

import { createAppliedResult } from '../../../core/verification/test/verification.fixture';
import { CHANGE_PLAN, VERIFICATION_REPORT } from '../../../ui/workspace/test/workspace.fixture';
import { CorrectionCancellationRegistry } from './correction-cancellation.registry';
import { CorrectionLoopCancelledError, CorrectionLoopService } from './correction-loop.service';
import type { CorrectionLoopBeginInput } from './correction-loop.types';

function failedInput(): CorrectionLoopBeginInput {
  return {
    workflowId: 'wf-cancel',
    applyStatus: 'APPLIED',
    createdPaths: [],
    updatedPaths: ['src/example.ts'],
    deletedPaths: [],
    verificationReport: {
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'FAILED',
          errors: [{ code: 'BUILD_FAILED', message: 'Type error' }],
        },
      ],
      errors: [],
    },
  };
}

describe('correction cancellation propagation', () => {
  it('cancels during diagnosis before PREPARE', async () => {
    const service = new CorrectionLoopService();
    const controller = new AbortController();
    controller.abort();
    const token = {
      get cancelled() {
        return controller.signal.aborted;
      },
      get reason() {
        return 'request aborted';
      },
      subscribe: () => () => undefined,
    };
    await expect(service.beginCorrection(failedInput(), { cancellation: token })).rejects.toThrow(
      CorrectionLoopCancelledError,
    );
    expect(service.getSession('wf-cancel')?.state).toBe('CORRECTION_CANCELLED');
  });

  it('runs cleanup handlers on cancel', async () => {
    const registry = new CorrectionCancellationRegistry();
    const cleanup = vi.fn();
    registry.registerCleanup('wf-clean', cleanup);
    await registry.cancel('wf-clean', 'operator cancelled');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(registry.isCancelled('wf-clean')).toBe(true);
  });

  it('blocks recordApplying after cancellation', async () => {
    const service = new CorrectionLoopService();
    await service.beginCorrection(failedInput());
    await service.cancelCorrection('wf-cancel');
    await expect(service.recordApplying('wf-cancel')).rejects.toThrow(/terminal|cancelled/i);
  });

  it('does not classify cancellation as a correctable failure', async () => {
    const service = new CorrectionLoopService();
    await service.beginCorrection(failedInput());
    await service.cancelCorrection('wf-cancel');
    const session = service.getSession('wf-cancel');
    expect(session?.blockCode).toBe('CANCELLATION');
    expect(session?.state).toBe('CORRECTION_CANCELLED');
  });

  it('rejectCorrection cancels safely without further APPLY transitions', async () => {
    const service = new CorrectionLoopService();
    await service.beginCorrection(failedInput());
    await service.recordPrepared('wf-cancel', 'prep-1', CHANGE_PLAN);
    const rejected = await service.rejectCorrection('wf-cancel');
    expect(rejected.state).toBe('CORRECTION_CANCELLED');
    await expect(
      service.recordVerificationComplete('wf-cancel', {
        applyResult: createAppliedResult(),
        verificationReport: VERIFICATION_REPORT,
      }),
    ).rejects.toThrow(/terminal/);
  });
});
