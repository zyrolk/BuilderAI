export interface PromptOrchestratorConfiguration {
  readonly templateId: string;
  readonly templateVersion?: number;
  readonly maximumCharacters: number;
}

/**
 * `maximumCharacters` is calibrated from real-repository measurement (P0-3, ADR-018), not an
 * arbitrary round number. Building a Prompt Package from the largest real Context Package
 * observed (see `DEFAULT_CONTEXT_LIMITS.maxCharacters` in
 * `src/core/context-builder/types/context-builder.ts`) measured 84,202 characters. 120,000 keeps
 * that content intact with roughly 35,800 characters (~30%) of reserved headroom, so the optional
 * CONTEXT section should not need to be dropped under real content, while remaining safely below
 * the configured AI provider's `maximumInputCharacters` (enforced at composition time by
 * `src/infrastructure/workspace/budget-invariant.ts`).
 */
export const DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION: PromptOrchestratorConfiguration = {
  templateId: 'builderai-standard',
  templateVersion: 3,
  maximumCharacters: 120_000,
};
