import {
  VERIFICATION_STAGES,
  type VerificationStage,
  type VerificationStageStatus,
} from '../../core/verification';
import type { FeatureTaskOutcome, FeatureTaskOutcomeVerificationStage } from './feature-plan.types';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

export const MANDATORY_FEATURE_TASK_VERIFICATION_STAGES = VERIFICATION_STAGES;

export type { FeatureTaskOutcomeVerificationStage };

export function normalizeVerificationStages(
  value: unknown,
): readonly FeatureTaskOutcomeVerificationStage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const stages: FeatureTaskOutcomeVerificationStage[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const stage = Reflect.get(item, 'stage');
    const status = Reflect.get(item, 'status');
    if (typeof stage !== 'string' || typeof status !== 'string') continue;
    if (!(VERIFICATION_STAGES as readonly string[]).includes(stage)) continue;
    if (status !== 'PASSED' && status !== 'FAILED') continue;
    stages.push({
      stage: stage as VerificationStage,
      status: status as VerificationStageStatus,
    });
  }
  return stages.length === 0 ? undefined : stages;
}

export function hasMandatoryVerificationStageFailure(
  stages: readonly FeatureTaskOutcomeVerificationStage[],
): boolean {
  return MANDATORY_FEATURE_TASK_VERIFICATION_STAGES.some((mandatory) => {
    const result = stages.find(({ stage }) => stage === mandatory);
    return result?.status === 'FAILED';
  });
}

export function assertFeatureTaskCompletionAllowed(
  outcome: FeatureTaskOutcome,
  options: { readonly acknowledgePartialPass?: boolean },
): void {
  if (outcome.verificationStatus === 'FAILED') {
    throw new WorkspaceRuntimeError(
      'INVALID_REQUEST',
      'Task completion requires verification PASSED unless explicitly acknowledged.',
    );
  }

  if (
    outcome.verificationStages !== undefined &&
    hasMandatoryVerificationStageFailure(outcome.verificationStages)
  ) {
    throw new WorkspaceRuntimeError(
      'INVALID_REQUEST',
      'Task completion is blocked because a mandatory verification stage failed.',
    );
  }

  if (
    outcome.verificationStatus === 'PARTIALLY_PASSED' &&
    outcome.verificationStages === undefined
  ) {
    throw new WorkspaceRuntimeError(
      'INVALID_REQUEST',
      'Partial verification completion requires bounded verification stage evidence.',
    );
  }

  if (
    outcome.verificationStatus === 'PARTIALLY_PASSED' &&
    options.acknowledgePartialPass !== true
  ) {
    throw new WorkspaceRuntimeError(
      'INVALID_REQUEST',
      'Partial verification pass requires explicit operator acknowledgement.',
    );
  }

  if (outcome.verificationStatus !== 'PASSED' && options.acknowledgePartialPass !== true) {
    throw new WorkspaceRuntimeError(
      'INVALID_REQUEST',
      'Task completion requires verification PASSED unless explicitly acknowledged.',
    );
  }
}
