import type { VerificationValidationIssue } from './verification';

export class VerificationValidationError extends Error {
  readonly code = 'VERIFICATION_VALIDATION_FAILED' as const;

  constructor(readonly issues: readonly VerificationValidationIssue[]) {
    super(
      `Verification validation failed: ${issues
        .map(({ path, message }) => `${path} ${message}`)
        .join('; ')}.`,
    );
    this.name = 'VerificationValidationError';
  }
}
