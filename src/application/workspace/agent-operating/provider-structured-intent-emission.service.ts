import type { AIProviderResponse } from '../../../core/ai-provider';
import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import {
  AgentLoopError,
  parseProviderStructuredToolIntent,
  type ProviderStructuredToolIntent,
} from '../agent-loop';
import type { ProviderExecutionPort } from '../workspace-runtime.types';
import { AgentRunError } from './agent-run.types';
import type { AgentRun } from './agent-run.types';
import { buildProviderStructuredIntentExecutionRequest } from './provider-structured-intent-prompt';

/** Align with B8 HTTP intent cap; prefer fewer for a single explicit assisted turn. */
export const PROVIDER_STRUCTURED_INTENT_MAX = 6;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ProviderStructuredIntentEmissionDependencies {
  readonly providerExecution: ProviderExecutionPort;
  readonly ids: { generate(): string };
  readonly clock: { now(): Date };
  readonly providerTimeoutMs?: number;
}

/**
 * ADR-046: provider proposes structured intents only (toolCalling:false).
 * Never executes tools; never invents approvals or binding.
 */
export class ProviderStructuredIntentEmissionService {
  constructor(private readonly dependencies: ProviderStructuredIntentEmissionDependencies) {}

  async proposeIntents(input: {
    readonly run: AgentRun;
    readonly cancellation?: ExecutionCancellationToken;
  }): Promise<readonly ProviderStructuredToolIntent[]> {
    const executionId = this.dependencies.ids.generate();
    const requestedAt = this.dependencies.clock.now().toISOString();
    const request = buildProviderStructuredIntentExecutionRequest({
      executionId,
      goal: input.run.goal,
      phase: input.run.phase,
      runId: input.run.runId,
      projectId: input.run.projectId,
      requestedAt,
      timeoutMs: this.dependencies.providerTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      ...(input.cancellation === undefined ? {} : { cancellation: input.cancellation }),
    });

    let providerResponse: AIProviderResponse;
    try {
      const output = await this.dependencies.providerExecution.execute(request);
      providerResponse = output.providerResponse;
    } catch (error: unknown) {
      throw new AgentRunError(
        'INVALID_GOAL',
        error instanceof Error
          ? `Provider structured-intent emission failed: ${error.message}`
          : 'Provider structured-intent emission failed.',
      );
    }

    const structured = extractStructuredData(providerResponse);
    return parseProviderIntentBatch(structured);
  }
}

export function parseProviderIntentBatch(raw: unknown): readonly ProviderStructuredToolIntent[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentRunError(
      'INVALID_GOAL',
      'Provider structured-intent output must be a non-array object.',
    );
  }
  const record = raw as Record<string, unknown>;
  // Top-level authority / binding forgery
  for (const key of Object.keys(record)) {
    if (
      key === 'approved' ||
      key === 'operatorApproved' ||
      key === 'browserObservationApproved' ||
      key === 'applyAuthorizationToken' ||
      key === 'changePlan' ||
      key === 'projectId' ||
      key === 'runId' ||
      key === 'phase'
    ) {
      throw new AgentRunError(
        'INVALID_GOAL',
        `Provider must not supply authority/binding field "${key}" on structured-intent output.`,
      );
    }
  }

  const intentsRaw = record.intents;
  if (!Array.isArray(intentsRaw)) {
    throw new AgentRunError(
      'INVALID_GOAL',
      'Provider structured-intent output requires intents[].',
    );
  }
  if (intentsRaw.length === 0) {
    throw new AgentRunError(
      'INVALID_GOAL',
      'Provider structured-intent output intents[] must not be empty.',
    );
  }
  if (intentsRaw.length > PROVIDER_STRUCTURED_INTENT_MAX) {
    throw new AgentRunError(
      'INVALID_GOAL',
      `Provider may propose at most ${PROVIDER_STRUCTURED_INTENT_MAX} intents per assisted turn.`,
    );
  }

  try {
    return intentsRaw.map((entry) => parseProviderStructuredToolIntent(entry));
  } catch (error: unknown) {
    if (error instanceof AgentLoopError) {
      throw new AgentRunError('INVALID_GOAL', error.message);
    }
    throw error;
  }
}

function extractStructuredData(response: AIProviderResponse): unknown {
  const structured = response.artifacts.find((artifact) => artifact.kind === 'STRUCTURED_DATA');
  if (structured?.kind === 'STRUCTURED_DATA') {
    return structured.data;
  }
  const text = response.artifacts.find((artifact) => artifact.kind === 'TEXT');
  if (text?.kind === 'TEXT') {
    try {
      return JSON.parse(text.content) as unknown;
    } catch {
      throw new AgentRunError(
        'INVALID_GOAL',
        'Provider structured-intent text was not valid JSON.',
      );
    }
  }
  throw new AgentRunError(
    'INVALID_GOAL',
    'Provider response did not include structured tool intents.',
  );
}
