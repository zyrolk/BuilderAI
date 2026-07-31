import type { ChangePlanValidationIssue } from './change-plan';

export class ChangePlanValidationError extends Error {
  readonly code = 'CHANGE_PLAN_VALIDATION_FAILED' as const;

  constructor(readonly issues: readonly ChangePlanValidationIssue[]) {
    super(
      `Project change plan validation failed: ${issues
        .map(({ path, message }) => `${path} ${message}`)
        .join('; ')}.`,
    );
    this.name = 'ChangePlanValidationError';
  }
}
