import { describe, expect, it } from 'vitest';

import {
  assertFeatureTaskCompletionAllowed,
  hasMandatoryVerificationStageFailure,
} from './feature-task-completion';
import type { FeatureTaskOutcome } from './feature-plan.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

const NOW = '2026-08-02T00:00:00.000Z';

function outcome(overrides: Partial<FeatureTaskOutcome> = {}): FeatureTaskOutcome {
  return {
    summary: 'Done',
    completedAt: NOW,
    ...overrides,
  };
}

describe('assertFeatureTaskCompletionAllowed', () => {
  it('rejects completion when TEST_VALIDATION failed', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(
        outcome({
          verificationStatus: 'PARTIALLY_PASSED',
          verificationStages: [
            { stage: 'PROJECT_VALIDATION', status: 'PASSED' },
            { stage: 'DEPENDENCY_VALIDATION', status: 'PASSED' },
            { stage: 'BUILD_VALIDATION', status: 'PASSED' },
            { stage: 'TEST_VALIDATION', status: 'FAILED' },
          ],
        }),
        { acknowledgePartialPass: true },
      ),
    ).toThrow(WorkspaceRuntimeError);
  });

  it('rejects completion when BUILD_VALIDATION failed', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(
        outcome({
          verificationStatus: 'PARTIALLY_PASSED',
          verificationStages: [
            { stage: 'PROJECT_VALIDATION', status: 'PASSED' },
            { stage: 'DEPENDENCY_VALIDATION', status: 'PASSED' },
            { stage: 'BUILD_VALIDATION', status: 'FAILED' },
            { stage: 'TEST_VALIDATION', status: 'PASSED' },
          ],
        }),
        { acknowledgePartialPass: true },
      ),
    ).toThrow(WorkspaceRuntimeError);
  });

  it('rejects completion when DEPENDENCY_VALIDATION failed', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(
        outcome({
          verificationStatus: 'PARTIALLY_PASSED',
          verificationStages: [
            { stage: 'PROJECT_VALIDATION', status: 'PASSED' },
            { stage: 'DEPENDENCY_VALIDATION', status: 'FAILED' },
            { stage: 'BUILD_VALIDATION', status: 'PASSED' },
            { stage: 'TEST_VALIDATION', status: 'PASSED' },
          ],
        }),
        { acknowledgePartialPass: true },
      ),
    ).toThrow(WorkspaceRuntimeError);
  });

  it('rejects completion when PROJECT_VALIDATION failed', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(
        outcome({
          verificationStatus: 'PARTIALLY_PASSED',
          verificationStages: [
            { stage: 'PROJECT_VALIDATION', status: 'FAILED' },
            { stage: 'DEPENDENCY_VALIDATION', status: 'PASSED' },
            { stage: 'BUILD_VALIDATION', status: 'PASSED' },
            { stage: 'TEST_VALIDATION', status: 'PASSED' },
          ],
        }),
        { acknowledgePartialPass: true },
      ),
    ).toThrow(WorkspaceRuntimeError);
  });

  it('does not allow acknowledgePartialPass to override a mandatory failed stage', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(
        outcome({
          verificationStatus: 'PARTIALLY_PASSED',
          acknowledgedPartialPass: true,
          verificationStages: [
            { stage: 'PROJECT_VALIDATION', status: 'PASSED' },
            { stage: 'DEPENDENCY_VALIDATION', status: 'PASSED' },
            { stage: 'BUILD_VALIDATION', status: 'PASSED' },
            { stage: 'TEST_VALIDATION', status: 'FAILED' },
          ],
        }),
        { acknowledgePartialPass: true },
      ),
    ).toThrow(/mandatory verification stage failed/i);
  });

  it('allows PASSED completion when all mandatory stages passed', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(
        outcome({
          verificationStatus: 'PASSED',
          verificationStages: [
            { stage: 'PROJECT_VALIDATION', status: 'PASSED' },
            { stage: 'DEPENDENCY_VALIDATION', status: 'PASSED' },
            { stage: 'BUILD_VALIDATION', status: 'PASSED' },
            { stage: 'TEST_VALIDATION', status: 'PASSED' },
          ],
        }),
        {},
      ),
    ).not.toThrow();
  });

  it('allows PASSED completion without stage evidence for backward compatibility', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(outcome({ verificationStatus: 'PASSED' }), {}),
    ).not.toThrow();
  });

  it('requires stage evidence for PARTIALLY_PASSED even with acknowledgement', () => {
    expect(() =>
      assertFeatureTaskCompletionAllowed(outcome({ verificationStatus: 'PARTIALLY_PASSED' }), {
        acknowledgePartialPass: true,
      }),
    ).toThrow(/verification stage evidence/i);
  });
});

describe('hasMandatoryVerificationStageFailure', () => {
  it('detects any mandatory stage failure', () => {
    expect(
      hasMandatoryVerificationStageFailure([{ stage: 'TEST_VALIDATION', status: 'FAILED' }]),
    ).toBe(true);
    expect(
      hasMandatoryVerificationStageFailure([{ stage: 'TEST_VALIDATION', status: 'PASSED' }]),
    ).toBe(false);
  });
});
