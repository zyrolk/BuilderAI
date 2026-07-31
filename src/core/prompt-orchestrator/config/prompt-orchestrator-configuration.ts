export interface PromptOrchestratorConfiguration {
  readonly templateId: string;
  readonly templateVersion?: number;
  readonly maximumCharacters: number;
}

export const DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION: PromptOrchestratorConfiguration = {
  templateId: 'builderai-standard',
  templateVersion: 1,
  maximumCharacters: 75_000,
};
