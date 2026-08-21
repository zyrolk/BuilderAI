export interface ApprovalBinding {
  readonly workflowId: string;
  readonly preparationId: string;
  readonly changePlanDigest: string;
  readonly diffDigest: string;
  readonly baselineDigest: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

export interface ApprovalValidationInput {
  readonly binding: ApprovalBinding;
  readonly currentChangePlanDigest: string;
  readonly currentDiffDigest: string;
  readonly currentBaselineDigest: string;
  readonly now: Date;
}

export type ApprovalValidationOutcome =
  | { readonly kind: 'VALID' }
  | {
      readonly kind: 'INVALID';
      readonly code:
        'APPROVAL_EXPIRED' | 'CHANGE_PLAN_MISMATCH' | 'DIFF_MISMATCH' | 'BASELINE_MISMATCH';
      readonly message: string;
    };
