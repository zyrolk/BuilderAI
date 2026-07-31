import type { ResponseProcessorValidationIssue } from './response-processor';

export class ResponseProcessorValidationError extends Error {
  readonly code = 'RESPONSE_PROCESSOR_VALIDATION_FAILED' as const;

  constructor(readonly issues: readonly ResponseProcessorValidationIssue[]) {
    super(
      `Response processing validation failed: ${issues
        .map(({ path, message }) => `${path} ${message}`)
        .join('; ')}.`,
    );
    this.name = 'ResponseProcessorValidationError';
  }
}
