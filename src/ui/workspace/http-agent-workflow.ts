'use client';

import type { ExplainArtifact } from '../../application/workspace/agent-operating/explain-artifact.types';
import { WorkspaceWorkflowError } from './workspace.types';

export type { ExplainArtifact };

export interface AgentRunHttpView {
  readonly runId: string;
  readonly projectId: string;
  readonly goal: string;
  readonly phase: string;
  readonly status: string;
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

export interface AgentGate2Summary {
  readonly schemaVersion: number;
  readonly totalCharacterCount: number;
  readonly truncated: boolean;
  readonly operationCount: number;
  readonly truncationMessage?: string;
}

export interface AgentStartResponse {
  readonly run: AgentRunHttpView;
  readonly investigationId: string;
}

export interface AgentToolEvidenceItem {
  readonly toolId: string;
  readonly intentId: string;
  readonly phase: string;
  readonly status: string;
  readonly recordedAt: string;
  readonly summaryDigest: string;
  readonly errorCode?: string;
}

export interface AgentToolLoopStatus {
  readonly evidence: readonly AgentToolEvidenceItem[];
  readonly budget?: {
    readonly toolCalls: number;
    readonly providerTurns: number;
    readonly b4VerificationCalls: number;
    readonly browserObservationCalls: number;
  };
}

export interface AgentStatusResponse {
  readonly run: AgentRunHttpView;
  /** Bounded AgentLoop digests from B8 status projection (ADR-044/045). */
  readonly toolLoop?: AgentToolLoopStatus;
}

export interface AgentPlanResponse {
  readonly run: AgentRunHttpView;
  readonly preparationId: string;
  readonly expiresAt: string;
  readonly awaitingGate2: boolean;
  readonly gate2Review: AgentGate2Summary;
  readonly applyAuthorizationToken?: string;
}

export interface AgentApproveSuccessResponse {
  readonly run: AgentRunHttpView;
  readonly applyStatus: string | null;
  readonly verificationStatus: string | null;
  readonly explanation?: {
    readonly summary: string;
    readonly applyStatus: string | null;
    readonly verificationStatus: string | null;
  };
  readonly explain?: ExplainArtifact;
  readonly correctionWorkflowId?: string;
  readonly canPrepareCorrection?: boolean;
  readonly awaitingCorrectionApproval?: boolean;
}

export interface AgentCancelResponse {
  readonly run: AgentRunHttpView;
}

export interface AgentExplainResponse {
  readonly run: AgentRunHttpView;
  readonly explain: ExplainArtifact;
  readonly persisted: boolean;
}

export interface AgentToolTurnResponse {
  readonly run: AgentRunHttpView;
  readonly budget: {
    readonly toolCalls: number;
    readonly providerTurns: number;
    readonly b4VerificationCalls: number;
    readonly browserObservationCalls: number;
  };
  readonly evidence: readonly {
    readonly toolId: string;
    readonly intentId: string;
    readonly phase: string;
    readonly status: string;
    readonly recordedAt: string;
    readonly summaryDigest: string;
    readonly errorCode?: string;
  }[];
  readonly turn: Record<string, unknown>;
  readonly emission?: {
    readonly source: string;
    readonly toolCalling: boolean;
  };
}

/**
 * Thin HTTP client for P1-A Agent Operating routes.
 * Server remains authoritative for Gate 2 / APPLY.
 */
export class HttpAgentWorkflow {
  async start(goal: string): Promise<AgentStartResponse> {
    return post('/api/workspace/agent/run', { goal });
  }

  async getStatus(runId: string): Promise<AgentStatusResponse> {
    return get(`/api/workspace/agent/run/${encodeURIComponent(runId)}`);
  }

  async getExplain(runId: string): Promise<AgentExplainResponse> {
    return get(`/api/workspace/agent/run/${encodeURIComponent(runId)}/explain`);
  }

  async plan(runId: string): Promise<AgentPlanResponse> {
    return post(`/api/workspace/agent/run/${encodeURIComponent(runId)}/plan`, {});
  }

  async approve(
    runId: string,
    options: { readonly approved: true; readonly applyAuthorizationToken?: string },
  ): Promise<AgentApproveSuccessResponse> {
    const body: Record<string, unknown> = { approved: options.approved };
    if (options.applyAuthorizationToken !== undefined) {
      body.applyAuthorizationToken = options.applyAuthorizationToken;
    }
    return post(`/api/workspace/agent/run/${encodeURIComponent(runId)}/approve`, body);
  }

  async cancel(runId: string, reason?: string): Promise<AgentCancelResponse> {
    return post(`/api/workspace/agent/run/${encodeURIComponent(runId)}/cancel`, {
      ...(reason === undefined || reason.trim().length === 0 ? {} : { reason: reason.trim() }),
    });
  }

  async toolTurn(
    runId: string,
    body: {
      readonly intent?: unknown;
      readonly intents?: readonly unknown[];
      /** Distinct B7 OPERATOR signal — never inferred from Gate2/Git. */
      readonly browserObservationApproved?: boolean;
    },
  ): Promise<AgentToolTurnResponse> {
    // Strip accidental authority keys client-side; server still rejects them.
    const safeBody: {
      readonly intent?: unknown;
      readonly intents?: readonly unknown[];
      readonly browserObservationApproved?: boolean;
    } = {
      ...(body.intent === undefined ? {} : { intent: body.intent }),
      ...(body.intents === undefined ? {} : { intents: body.intents }),
      ...(body.browserObservationApproved === true ? { browserObservationApproved: true } : {}),
    };
    return post(`/api/workspace/agent/run/${encodeURIComponent(runId)}/tool-turn`, safeBody);
  }

  /**
   * ADR-046: explicit provider-assisted tool turn. Never sends client intents;
   * server proposes via toolCalling:false provider output then executes via AgentLoop.
   */
  async providerToolTurn(
    runId: string,
    body: {
      /** Distinct B7 OPERATOR signal — never inferred from Gate2/Git or provider output. */
      readonly browserObservationApproved?: boolean;
    } = {},
  ): Promise<AgentToolTurnResponse> {
    const safeBody: { readonly browserObservationApproved?: boolean } = {
      ...(body.browserObservationApproved === true ? { browserObservationApproved: true } : {}),
    };
    return post(
      `/api/workspace/agent/run/${encodeURIComponent(runId)}/provider-tool-turn`,
      safeBody,
    );
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  return parseJson<T>(response);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return parseJson<T>(response);
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { code?: string; message?: string };
  if (!response.ok) {
    throw new WorkspaceWorkflowError(
      payload.code ?? 'WORKFLOW_FAILED',
      payload.message ?? 'Agent request failed.',
    );
  }
  return payload as T;
}
