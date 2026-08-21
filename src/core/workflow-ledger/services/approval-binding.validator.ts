import type {
  ApprovalBinding,
  ApprovalValidationInput,
  ApprovalValidationOutcome,
} from '../types/approval-binding.types';

export function validateApprovalBinding(input: ApprovalValidationInput): ApprovalValidationOutcome {
  if (input.now.getTime() > Date.parse(input.binding.expiresAt)) {
    return {
      kind: 'INVALID',
      code: 'APPROVAL_EXPIRED',
      message: 'Approval has expired.',
    };
  }
  if (input.binding.changePlanDigest !== input.currentChangePlanDigest) {
    return {
      kind: 'INVALID',
      code: 'CHANGE_PLAN_MISMATCH',
      message: 'Change plan digest does not match approved preparation.',
    };
  }
  if (input.binding.diffDigest !== input.currentDiffDigest) {
    return {
      kind: 'INVALID',
      code: 'DIFF_MISMATCH',
      message: 'Gate 2 diff digest does not match approved preparation.',
    };
  }
  if (input.binding.baselineDigest !== input.currentBaselineDigest) {
    return {
      kind: 'INVALID',
      code: 'BASELINE_MISMATCH',
      message: 'Repository baseline digest does not match approved preparation.',
    };
  }
  return { kind: 'VALID' };
}

export function createApprovalBinding(input: {
  readonly workflowId: string;
  readonly preparationId: string;
  readonly changePlanDigest: string;
  readonly diffDigest: string;
  readonly baselineDigest: string;
  readonly approvedAt: Date;
  readonly expiresAt: Date;
  readonly approvalIdentity: string;
}): ApprovalBinding {
  return {
    workflowId: input.workflowId,
    preparationId: input.preparationId,
    changePlanDigest: input.changePlanDigest,
    diffDigest: input.diffDigest,
    baselineDigest: input.baselineDigest,
    approvedAt: input.approvedAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  };
}
