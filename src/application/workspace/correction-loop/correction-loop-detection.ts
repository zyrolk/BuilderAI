import type { ProjectChangePlan } from '../../../core/change-planner';
import type { CorrectionAttemptRecord, CorrectionDiagnostic } from './correction-loop.types';
import { digestChangePlan } from './correction-diagnostic.service';

export type CorrectionLoopClassification =
  'CONTINUE' | 'SAME_PLAN' | 'SAME_FAILURE_SAME_PLAN' | 'NEW_FAILURE';

export type CorrectionLoopDetectionResult =
  | { readonly kind: 'CONTINUE'; readonly classification: 'CONTINUE' | 'NEW_FAILURE' }
  | {
      readonly kind: 'LOOP_DETECTED';
      readonly classification: 'SAME_PLAN';
      readonly reason: string;
    }
  | {
      readonly kind: 'SAME_FAILURE_SAME_PLAN';
      readonly classification: 'SAME_FAILURE_SAME_PLAN';
      readonly reason: string;
    };

export function detectCorrectionLoop(input: {
  readonly diagnostic: CorrectionDiagnostic;
  readonly changePlan?: ProjectChangePlan;
  readonly attemptHistory: readonly CorrectionAttemptRecord[];
}): CorrectionLoopDetectionResult {
  const previous = input.attemptHistory.at(-1);
  if (previous === undefined) {
    return { kind: 'CONTINUE', classification: 'CONTINUE' };
  }

  const isNewFailure =
    previous.failureCategory !== input.diagnostic.failureCategory ||
    previous.diagnosticDigest !== input.diagnostic.diagnosticDigest;

  if (input.changePlan === undefined) {
    return {
      kind: 'CONTINUE',
      classification: isNewFailure ? 'NEW_FAILURE' : 'CONTINUE',
    };
  }

  const digest = digestChangePlan(input.changePlan);
  const duplicatePlan = input.attemptHistory.some(
    ({ changePlanDigest }) => changePlanDigest === digest,
  );
  if (duplicatePlan) {
    return {
      kind: 'LOOP_DETECTED',
      classification: 'SAME_PLAN',
      reason: 'Proposed correction matches a previous correction ChangePlan.',
    };
  }

  if (
    !isNewFailure &&
    previous.changePlanDigest !== undefined &&
    previous.changePlanDigest === digest
  ) {
    return {
      kind: 'SAME_FAILURE_SAME_PLAN',
      classification: 'SAME_FAILURE_SAME_PLAN',
      reason:
        'Verification failure is unchanged and the correction plan matches the prior attempt.',
    };
  }

  return {
    kind: 'CONTINUE',
    classification: isNewFailure ? 'NEW_FAILURE' : 'CONTINUE',
  };
}

export function listChangedPaths(changePlan: ProjectChangePlan): readonly string[] {
  return changePlan.changeSet.operations
    .map(({ logicalPath }) => logicalPath)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort((left, right) => left.localeCompare(right));
}
