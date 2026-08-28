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
import {
  buildProviderAssistedTurnDigest,
  rejectionFromAgentLoopError,
  rejectionFromBatchError,
} from './provider-assisted-turn-rejection';
import type {
  ProviderAssistedIntentRejection,
  ProviderAssistedTurnDigest,
} from './provider-assisted-turn.types';
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
    try {
      const result = await this.proposeIntentsWithDigest(input);
      return result.intents;
    } catch (error: unknown) {
      if (error instanceof ProviderIntentBatchRejectedError) {
        throw new AgentRunError('INVALID_GOAL', error.message);
      }
      throw error;
    }
  }

  async proposeIntentsWithDigest(input: {
    readonly run: AgentRun;
    readonly cancellation?: ExecutionCancellationToken;
  }): Promise<{
    readonly intents: readonly ProviderStructuredToolIntent[];
    readonly digest: ProviderAssistedTurnDigest;
  }> {
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
      const rejection = rejectionFromBatchError(
        'PROVIDER_EXECUTION_FAILED',
        error instanceof Error
          ? `Provider structured-intent emission failed: ${error.message}`
          : 'Provider structured-intent emission failed.',
      );
      throw new ProviderIntentBatchRejectedError(
        rejection.message,
        buildProviderAssistedTurnDigest({
          proposedCount: 0,
          acceptedCount: 0,
          rejections: [rejection],
        }),
      );
    }

    const structured = extractStructuredData(providerResponse);
    return parseProviderIntentBatchWithDiagnostics(structured);
  }
}

export class ProviderIntentBatchRejectedError extends AgentRunError {
  readonly digest: ProviderAssistedTurnDigest;

  constructor(message: string, digest: ProviderAssistedTurnDigest) {
    super('INVALID_GOAL', message);
    this.name = 'ProviderIntentBatchRejectedError';
    this.digest = digest;
  }
}

export function parseProviderIntentBatchWithDiagnostics(raw: unknown): {
  readonly intents: readonly ProviderStructuredToolIntent[];
  readonly digest: ProviderAssistedTurnDigest;
} {
  const rejections: ProviderAssistedIntentRejection[] = [];

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    const rejection = rejectionFromBatchError(
      'MALFORMED_OUTPUT',
      'Provider structured-intent output must be a non-array object.',
    );
    throw new ProviderIntentBatchRejectedError(
      rejection.message,
      buildProviderAssistedTurnDigest({
        proposedCount: 0,
        acceptedCount: 0,
        rejections: [rejection],
      }),
    );
  }

  const record = raw as Record<string, unknown>;
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
      const rejection = rejectionFromBatchError(
        'AUTHORITY_FIELD_FORBIDDEN',
        `Provider must not supply authority/binding field "${key}" on structured-intent output.`,
      );
      throw new ProviderIntentBatchRejectedError(
        rejection.message,
        buildProviderAssistedTurnDigest({
          proposedCount: 0,
          acceptedCount: 0,
          rejections: [rejection],
        }),
      );
    }
  }

  const intentsRaw = record.intents;
  if (!Array.isArray(intentsRaw)) {
    const rejection = rejectionFromBatchError(
      'MISSING_INTENTS_ARRAY',
      'Provider structured-intent output requires intents[].',
    );
    throw new ProviderIntentBatchRejectedError(
      rejection.message,
      buildProviderAssistedTurnDigest({
        proposedCount: 0,
        acceptedCount: 0,
        rejections: [rejection],
      }),
    );
  }

  const proposedCount = intentsRaw.length;
  if (proposedCount === 0) {
    const rejection = rejectionFromBatchError(
      'EMPTY_INTENTS',
      'Provider structured-intent output intents[] must not be empty.',
    );
    throw new ProviderIntentBatchRejectedError(
      rejection.message,
      buildProviderAssistedTurnDigest({
        proposedCount: 0,
        acceptedCount: 0,
        rejections: [rejection],
      }),
    );
  }
  if (proposedCount > PROVIDER_STRUCTURED_INTENT_MAX) {
    const rejection = rejectionFromBatchError(
      'EXCEEDS_INTENT_CAP',
      `Provider may propose at most ${PROVIDER_STRUCTURED_INTENT_MAX} intents per assisted turn.`,
    );
    throw new ProviderIntentBatchRejectedError(
      rejection.message,
      buildProviderAssistedTurnDigest({
        proposedCount,
        acceptedCount: 0,
        rejections: [rejection],
      }),
    );
  }

  const accepted: ProviderStructuredToolIntent[] = [];
  intentsRaw.forEach((entry, index) => {
    const intentRecord =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : undefined;
    const intentId =
      typeof intentRecord?.intentId === 'string' ? intentRecord.intentId.trim() : undefined;
    const toolId =
      typeof intentRecord?.toolId === 'string' ? intentRecord.toolId.trim() : undefined;
    try {
      accepted.push(parseProviderStructuredToolIntent(entry));
    } catch (error: unknown) {
      if (error instanceof AgentLoopError) {
        rejections.push(
          rejectionFromAgentLoopError(error, {
            intentIndex: index,
            ...(intentId === undefined || intentId.length === 0 ? {} : { intentId }),
            ...(toolId === undefined || toolId.length === 0 ? {} : { toolId }),
          }),
        );
        return;
      }
      throw error;
    }
  });

  if (accepted.length === 0) {
    const batchRejection = rejectionFromBatchError(
      'ALL_INTENTS_REJECTED',
      'Every provider-proposed intent was rejected by server validation.',
    );
    rejections.push(batchRejection);
    throw new ProviderIntentBatchRejectedError(
      batchRejection.message,
      buildProviderAssistedTurnDigest({
        proposedCount,
        acceptedCount: 0,
        rejections,
      }),
    );
  }

  return {
    intents: accepted,
    digest: buildProviderAssistedTurnDigest({
      proposedCount,
      acceptedCount: accepted.length,
      rejections,
    }),
  };
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
      const rejection = rejectionFromBatchError(
        'INVALID_JSON',
        'Provider structured-intent text was not valid JSON.',
      );
      throw new ProviderIntentBatchRejectedError(
        rejection.message,
        buildProviderAssistedTurnDigest({
          proposedCount: 0,
          acceptedCount: 0,
          rejections: [rejection],
        }),
      );
    }
  }
  const rejection = rejectionFromBatchError(
    'NO_STRUCTURED_DATA',
    'Provider response did not include structured tool intents.',
  );
  throw new ProviderIntentBatchRejectedError(
    rejection.message,
    buildProviderAssistedTurnDigest({
      proposedCount: 0,
      acceptedCount: 0,
      rejections: [rejection],
    }),
  );
}
