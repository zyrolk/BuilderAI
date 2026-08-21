import { NextResponse } from 'next/server';

import { AgentRunError, type AgentRun } from '../../../../application/workspace/agent-operating';
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

export function agentJson(value: unknown, status: number): NextResponse {
  return NextResponse.json(value, { status, headers: SAFE_HEADERS });
}

export function mapAgentRouteError(error: unknown): NextResponse {
  if (error instanceof LocalRequestRejectedError) {
    return agentJson({ code: error.code, message: error.message }, 403);
  }
  if (error instanceof AgentRunError) {
    return agentJson({ code: error.code, message: error.message }, mapAgentRunErrorStatus(error));
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
    'baselineDigest',
    'preparationId',
    'workflowId',
    'approvalBinding',
    'applyResult',
    'verificationReport',
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
