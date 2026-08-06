import type { ExecutionRequest } from '../../../core/execution-engine';
import type { PromptPackage } from '../../../core/prompt-orchestrator';
import { buildInvestigationPrompt } from './investigation-prompt.builder';
import type { InvestigationEvidence, RepositorySearchResult } from './investigation.types';

export function buildInvestigationPromptPackage(
  request: string,
  searchResult: RepositorySearchResult,
  evidence: readonly InvestigationEvidence[],
): PromptPackage {
  const content = buildInvestigationPrompt(request, searchResult, evidence);
  const packageValue: PromptPackage = {
    schemaVersion: 1,
    template: { id: 'builderai-investigation', version: 1 },
    sections: [
      {
        id: 'investigation-system',
        kind: 'SYSTEM',
        required: true,
        identity: {
          projectId: 'investigation',
          projectName: 'BuilderAI Investigation',
          vision: 'Read-only repository investigation.',
          currentMilestone: 'Investigation',
        },
        instructions: [{ id: 'investigation-contract', text: content, source: 'TEMPLATE' }],
      },
    ],
    metadata: {
      sourceContextSchemaVersion: 1,
      sourceContextCharacters: content.length,
      values: { mode: 'INVESTIGATION' },
    },
    budget: {
      characters: content.length,
      maximumCharacters: content.length,
      omittedSections: [],
    },
  };
  return packageValue;
}

export function buildInvestigationExecutionRequest(input: {
  readonly executionId: string;
  readonly request: string;
  readonly searchResult: RepositorySearchResult;
  readonly evidence: readonly InvestigationEvidence[];
  readonly requestedAt: string;
  readonly timeoutMs: number;
}): ExecutionRequest {
  const prompt = buildInvestigationPromptPackage(input.request, input.searchResult, input.evidence);
  return {
    schemaVersion: 1,
    executionId: input.executionId,
    prompt,
    metadata: {
      correlationId: input.executionId,
      requestedAt: input.requestedAt,
      values: { source: 'investigation' },
    },
    policy: {
      priority: 'NORMAL',
      validationMode: 'STRICT',
      failureStrategy: 'RETRY_THEN_FAIL',
      retry: {
        maximumRetries: 1,
        delayStrategy: 'FIXED',
        baseDelayMs: 300,
        maximumDelayMs: 300,
        retryableErrorCodes: ['OUTPUT_TRUNCATED', 'PROVIDER_UNAVAILABLE'],
      },
      timeout: { durationMs: input.timeoutMs, startsAt: 'QUEUED' },
    },
    cancellation: { cancelled: false, subscribe: () => () => undefined },
  };
}
