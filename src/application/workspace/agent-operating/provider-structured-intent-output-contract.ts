import type { PromptOutputContract } from '../../../core/prompt-orchestrator';

/** Explicit JSON shape for provider-proposed tool intents (ADR-046). Field names are normative. */
export const PROVIDER_STRUCTURED_INTENT_OUTPUT_JSON_SHAPE = [
  'Return JSON only with this exact shape:',
  '{',
  '  "schemaVersion": 1,',
  '  "intents": [',
  '    { "toolId": string, "intentId": string, "arguments": object }',
  '  ]',
  '}',
  'Propose at most 6 soft read/inspect intents using only known registry toolIds such as',
  'search_repository or inspect_readiness when appropriate for the current AgentRun phase.',
  'Never include approved, operatorApproved, browserObservationApproved, applyAuthorizationToken,',
  'changePlan, projectId, runId, phase, cwd, env, shell, credentials, cookies, storageState,',
  'absolute URLs, FileApply, approveAndApply, git_push, run_shell, mcp_*, open_web, or http_fetch.',
  'Never claim approvals or authorize mutation. Provider output is DATA only.',
].join('\n');

export const PROVIDER_STRUCTURED_INTENT_OUTPUT_CONTRACT: PromptOutputContract = {
  schemaVersion: 1,
  type: 'OBJECT',
  fields: [
    {
      name: 'schemaVersion',
      description: 'Structured intent emission schema version.',
      type: 'NUMBER',
      required: true,
    },
    {
      name: 'intents',
      description:
        'Array of { toolId: string, intentId: string, arguments?: object }. Soft tools only; no authority fields.',
      type: 'ARRAY',
      required: true,
    },
  ],
  allowAdditionalFields: false,
};
