import { NextResponse } from 'next/server';

import { AgentRunError, type AgentRun } from '../../../../application/workspace/agent-operating';
import type { Gate2PlanningProvenanceReview } from '../../../../application/workspace/agent-operating/gate2-planning-provenance.types';
import { GATE2_PLANNING_PROVENANCE_LIMITS } from '../../../../application/workspace/agent-operating/gate2-planning-provenance.types';
import { ProviderIntentBatchRejectedError } from '../../../../application/workspace/agent-operating/provider-structured-intent-emission.service';
import type { ProviderAssistedTurnDigest } from '../../../../application/workspace/agent-operating/provider-assisted-turn.types';
import { AgentLoopError } from '../../../../application/workspace/agent-loop';
import type {
  BoundedToolEvidenceRecord,
  BoundedVerificationEvidence,
} from '../../../../application/workspace/agent-loop';
import { validateVerificationEvidenceForPersistence } from '../../../../application/workspace/agent-loop/bounded-verification-evidence';
import { WorkspaceRuntimeError } from '../../../../application/workspace';
import {
  LocalRequestRejectedError,
  mapWorkspaceRuntimeErrorStatus,
} from '../../../../infrastructure/workspace';

const SAFE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
} as const;

/** Bounded AgentRun projection for HTTP — no ChangePlan, secrets, or raw bodies. */
export interface AgentRunHttpView {
  readonly runId: string;
  readonly projectId: string;
  readonly goal: string;
  readonly phase: AgentRun['phase'];
  readonly status: AgentRun['status'];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly awaitingGate2: boolean;
  readonly references: {
    readonly investigationId?: string;
    readonly featurePlanId?: string;
    readonly preparationId?: string;
    readonly workflowId?: string;
    readonly correctionWorkflowId?: string;
  };
}

export function toAgentRunHttpView(run: AgentRun): AgentRunHttpView {
  return {
    runId: run.runId,
    projectId: run.projectId,
    goal: run.goal,
    phase: run.phase,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    awaitingGate2: run.phase === 'AWAITING_GATE2' && run.status === 'AWAITING_GATE2',
    references: { ...run.references },
  };
}

export function toBoundedToolEvidenceHttpView(
  record: BoundedToolEvidenceRecord,
  options?: {
    readonly verificationDiagnosticSummary?: string;
  },
): {
  readonly toolId: string;
  readonly intentId: string;
  readonly phase: string;
  readonly status: string;
  readonly recordedAt: string;
  readonly summaryDigest: string;
  readonly errorCode?: string;
  readonly verificationDiagnosticSummary?: string;
  readonly verificationEvidence?: {
    readonly evidenceSchemaVersion: 1;
    readonly commandId: string;
    readonly stage: string;
    readonly executionStatus: string;
    readonly exitCode: number | null;
    readonly timedOut: boolean;
    readonly cancelled: boolean;
    readonly policyBlocked: boolean;
    readonly policyBlockCode?: string;
    readonly outputLimited: boolean;
  };
} {
  const diagnostic = options?.verificationDiagnosticSummary;
  const verificationEvidence = toVerificationEvidenceHttpView(record.verificationEvidence);
  return {
    toolId: record.toolId,
    intentId: record.intentId,
    phase: record.phase,
    status: record.status,
    recordedAt: record.recordedAt,
    summaryDigest: record.summaryDigest,
    ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
    ...(diagnostic === undefined || diagnostic.length === 0
      ? {}
      : { verificationDiagnosticSummary: diagnostic }),
    ...(verificationEvidence === undefined ? {} : { verificationEvidence }),
  };
}

/** Response-only explicit field pick for durable B4 structured status (ADR-050). */
export function toVerificationEvidenceHttpView(evidence: BoundedVerificationEvidence | undefined):
  | {
      readonly evidenceSchemaVersion: 1;
      readonly commandId: string;
      readonly stage: string;
      readonly executionStatus: string;
      readonly exitCode: number | null;
      readonly timedOut: boolean;
      readonly cancelled: boolean;
      readonly policyBlocked: boolean;
      readonly policyBlockCode?: string;
      readonly outputLimited: boolean;
    }
  | undefined {
  if (evidence === undefined) return undefined;
  if (!validateVerificationEvidenceForPersistence(evidence)) return undefined;
  return {
    evidenceSchemaVersion: 1,
    commandId: evidence.commandId,
    stage: evidence.stage,
    executionStatus: evidence.executionStatus,
    exitCode: evidence.exitCode,
    timedOut: evidence.timedOut,
    cancelled: evidence.cancelled,
    policyBlocked: evidence.policyBlocked,
    ...(evidence.policyBlockCode === undefined
      ? {}
      : { policyBlockCode: evidence.policyBlockCode }),
    outputLimited: evidence.outputLimited,
  };
}

const VERIFICATION_DIAGNOSTIC_MAX_CHARS = 1_024 as const;

/** Display-only bounded B4 diagnostic for tool-turn HTTP responses (ADR-049). */
export function extractBoundedVerificationDiagnostic(structured: unknown): string | undefined {
  if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) {
    return undefined;
  }
  const record = structured as Record<string, unknown>;
  const raw = record.diagnosticSummary;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length <= VERIFICATION_DIAGNOSTIC_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, VERIFICATION_DIAGNOSTIC_MAX_CHARS - 1)}…`;
}

export function resolveVerificationDiagnosticForTurn(input: {
  readonly record: BoundedToolEvidenceRecord;
  readonly turn:
    | {
        readonly intentId?: string;
        readonly toolId?: string;
        readonly toolResult?: { readonly structured?: unknown };
        readonly results?: readonly {
          readonly intentId: string;
          readonly toolId: string;
          readonly toolResult?: { readonly structured?: unknown };
        }[];
      }
    | undefined;
}): string | undefined {
  if (input.record.toolId !== 'run_verification_command') return undefined;
  const turn = input.turn;
  if (turn === undefined) return undefined;

  if (turn.results !== undefined) {
    const match = turn.results.find((item) => item.intentId === input.record.intentId);
    return extractBoundedVerificationDiagnostic(match?.toolResult?.structured);
  }

  if (turn.intentId !== input.record.intentId) return undefined;
  return extractBoundedVerificationDiagnostic(turn.toolResult?.structured);
}

export function toGate2PlanningProvenanceHttpView(
  review: Gate2PlanningProvenanceReview,
): Gate2PlanningProvenanceReview {
  const cap = GATE2_PLANNING_PROVENANCE_LIMITS.MAX_PATH_HINTS;
  return {
    schemaVersion: review.schemaVersion,
    hasP0Context: review.hasP0Context,
    hasOperatorContext: review.hasOperatorContext,
    p0PathHintCount: review.p0PathHintCount,
    operatorPathHintCount: review.operatorPathHintCount,
    mergedPathHintCount: review.mergedPathHintCount,
    plannedOperationCount: review.plannedOperationCount,
    plannedPathOverlapCount: review.plannedPathOverlapCount,
    unmatchedMergedHintCount: review.unmatchedMergedHintCount,
    p0OnlyPathHints: review.p0OnlyPathHints.slice(0, cap),
    operatorOnlyPathHints: review.operatorOnlyPathHints.slice(0, cap),
    mergedPathHints: review.mergedPathHints.slice(0, cap),
    matchedPlannedPaths: review.matchedPlannedPaths.slice(0, cap),
    unmatchedMergedPathHints: review.unmatchedMergedPathHints.slice(0, cap),
    truncated: review.truncated,
    ...(review.verification === undefined
      ? {}
      : {
          verification: {
            hasVerificationContext: true,
            baselineStatus: review.verification.baselineStatus,
            consideredCommandCount: review.verification.consideredCommandCount,
            failedCommandIds: [...review.verification.failedCommandIds],
            blockedCommandIds: [...review.verification.blockedCommandIds],
            timedOutCommandIds: [...review.verification.timedOutCommandIds],
            cancelledCommandIds: [...review.verification.cancelledCommandIds],
            succeededCommandIds: [...review.verification.succeededCommandIds],
          },
        }),
  };
}

export function toProviderAssistedDigestHttpView(
  digest: ProviderAssistedTurnDigest,
): Record<string, unknown> {
  return {
    source: digest.source,
    toolCalling: digest.toolCalling,
    proposedCount: digest.proposedCount,
    acceptedCount: digest.acceptedCount,
    rejectedCount: digest.rejectedCount,
    rejections: digest.rejections.map((rejection) => ({
      code: rejection.code,
      message: rejection.message,
      operatorAction: rejection.operatorAction,
      ...(rejection.intentIndex === undefined ? {} : { intentIndex: rejection.intentIndex }),
      ...(rejection.intentId === undefined ? {} : { intentId: rejection.intentId }),
      ...(rejection.toolId === undefined ? {} : { toolId: rejection.toolId }),
    })),
  };
}

export function agentJson(value: unknown, status: number): NextResponse {
  return NextResponse.json(value, { status, headers: SAFE_HEADERS });
}

export function mapAgentRouteError(error: unknown): NextResponse {
  if (error instanceof LocalRequestRejectedError) {
    return agentJson({ code: error.code, message: error.message }, 403);
  }
  if (error instanceof ProviderIntentBatchRejectedError) {
    return agentJson(
      {
        code: error.code,
        message: error.message,
        providerAssisted: toProviderAssistedDigestHttpView(error.digest),
      },
      mapAgentRunErrorStatus(error),
    );
  }
  if (error instanceof AgentRunError) {
    return agentJson({ code: error.code, message: error.message }, mapAgentRunErrorStatus(error));
  }
  if (error instanceof AgentLoopError) {
    return agentJson(
      { code: error.code, message: error.message },
      error.code === 'CONCURRENT_EXECUTION_REJECTED' ? 409 : 400,
    );
  }
  if (error instanceof WorkspaceRuntimeError) {
    const mapped = mapWorkspaceRuntimeErrorStatus(error);
    return agentJson({ code: error.code, message: error.message }, mapped ?? 409);
  }
  return agentJson(
    { code: 'WORKFLOW_FAILED', message: 'The agent workflow could not be completed.' },
    500,
  );
}

export function mapAgentRunErrorStatus(error: AgentRunError): number {
  switch (error.code) {
    case 'INVALID_GOAL':
      return 400;
    case 'NOT_FOUND':
      return 404;
    case 'INVALID_TRANSITION':
    case 'TERMINAL_STATE':
    case 'INVALID_REFERENCE':
      return 409;
    case 'CORRUPT_STATE':
    case 'PERSISTENCE_FAILED':
      return 500;
    default:
      return 409;
  }
}

export function readRequiredGoal(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Request body must be a JSON object.');
  }
  // Reject client-supplied authoritative mutation fields (ignored and fail-closed if present).
  assertNoClientAuthorityFields(body);
  const goal = Reflect.get(body, 'goal');
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'goal is required.');
  }
  return goal.trim();
}

export function assertNoClientAuthorityFields(body: object): void {
  const forbidden = [
    'changePlan',
    'diff',
    'gate2Review',
    'planningProvenance',
    'baselineDigest',
    'preparationId',
    'workflowId',
    'approvalBinding',
    'applyResult',
    'verificationReport',
    'verificationEvidence',
    'planningProjection',
    'verificationPlanningProjection',
    'verificationPlanningContext',
    'verificationPlanning',
    'baselineStatus',
    'consideredCommandIds',
    'failedCommandIds',
    'blockedCommandIds',
    'timedOutCommandIds',
    'cancelledCommandIds',
    'succeededCommandIds',
    'structuredFailureDiagnostics',
    'failureDiagnostics',
    'boundedFailureDiagnostics',
    'diagnosticSource',
    'diagnosticCommandId',
  ] as const;
  for (const key of forbidden) {
    if (Reflect.has(body, key)) {
      throw new WorkspaceRuntimeError(
        'INVALID_REQUEST',
        `Client-supplied ${key} is not accepted; server state is authoritative.`,
      );
    }
  }
}

/** Extra reject list for tool-turn — never mint Gate2 / Git / apply authority from the client. */
export function assertNoToolTurnAuthorityFields(body: object): void {
  const forbidden = [
    'applyAuthorizationToken',
    'approved',
    'operatorApproved',
    'changePlan',
    'repositoryRoot',
    'gitExecutable',
    'cwd',
    'env',
    'argv',
    'command',
    'shell',
    'bearerToken',
    'accessToken',
    'verificationEvidence',
    'planningProjection',
    'verificationPlanningProjection',
    'verificationPlanningContext',
    'verificationPlanning',
    'baselineStatus',
    'planningProvenance',
    'structuredFailureDiagnostics',
    'failureDiagnostics',
    'boundedFailureDiagnostics',
    'diagnosticSource',
    'diagnosticCommandId',
  ] as const;
  for (const key of forbidden) {
    if (Reflect.has(body, key)) {
      throw new WorkspaceRuntimeError(
        'INVALID_REQUEST',
        `Client-supplied ${key} is not accepted on tool-turn; server authorization is authoritative.`,
      );
    }
  }
}

/**
 * ADR-046 provider-tool-turn: reject authority fields and client-supplied intents.
 * Browser observation approval remains a distinct optional body flag (not Gate2/Git).
 */
export function assertNoProviderToolTurnAuthorityFields(body: object): void {
  assertNoToolTurnAuthorityFields(body);
  for (const key of ['intent', 'intents', 'toolId', 'arguments', 'args'] as const) {
    if (Reflect.has(body, key)) {
      throw new WorkspaceRuntimeError(
        'INVALID_REQUEST',
        `Client-supplied ${key} is not accepted on provider-tool-turn; provider proposes intents server-side.`,
      );
    }
  }
}

export function readToolTurnIntents(body: unknown): readonly unknown[] {
  if (typeof body !== 'object' || body === null) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Request body must be a JSON object.');
  }
  const intents = Reflect.get(body, 'intents');
  if (Array.isArray(intents)) {
    if (intents.length === 0) {
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'intents must not be empty.');
    }
    if (intents.length > 12) {
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Too many intents in one provider turn.');
    }
    return intents;
  }
  const intent = Reflect.get(body, 'intent');
  if (intent === undefined) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'intent or intents is required.');
  }
  return [intent];
}

export function readRunIdParam(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'runId is required.');
  }
  const runId = value.trim();
  if (
    runId.length > 128 ||
    runId.includes('..') ||
    runId.includes('/') ||
    runId.includes('\\') ||
    runId.includes('\0')
  ) {
    throw new WorkspaceRuntimeError('INVALID_REQUEST', 'runId is invalid.');
  }
  return runId;
}
