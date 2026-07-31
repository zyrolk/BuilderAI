import type { PromptValidationIssue } from './prompt-orchestrator';

export class PromptOrchestratorValidationError extends Error {
  readonly code = 'PROMPT_ORCHESTRATOR_VALIDATION_FAILED';

  constructor(readonly issues: readonly PromptValidationIssue[]) {
    super(`Prompt orchestration failed with ${issues.length} validation issue(s).`);
    this.name = 'PromptOrchestratorValidationError';
  }
}

export class PromptTemplateNotFoundError extends Error {
  readonly code = 'PROMPT_TEMPLATE_NOT_FOUND';

  constructor(
    readonly templateId: string,
    readonly templateVersion?: number,
  ) {
    super(
      `Prompt template '${templateId}'${templateVersion === undefined ? '' : ` version ${templateVersion}`} was not found.`,
    );
    this.name = 'PromptTemplateNotFoundError';
  }
}
