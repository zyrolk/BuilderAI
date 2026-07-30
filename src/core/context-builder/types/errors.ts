import type { ContextValidationIssue } from './context-builder';

export class ContextBuilderValidationError extends Error {
  readonly code = 'CONTEXT_BUILDER_VALIDATION_FAILED';

  constructor(readonly issues: readonly ContextValidationIssue[]) {
    super(`Context Builder validation failed with ${issues.length} issue(s).`);
    this.name = 'ContextBuilderValidationError';
  }
}
