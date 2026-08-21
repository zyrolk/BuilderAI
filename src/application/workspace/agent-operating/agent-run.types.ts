/**
 * P1-A Step 1: AgentRun orchestration metadata.
 *
 * AgentRun references existing P0 workflows; it does not authorize APPLY, hold a ChangePlan,
 * approve Gate 2, mutate files, or execute commands. See ADR-036.
 */

export const AGENT_RUN_SCHEMA_VERSION = 1 as const;

export const AGENT_RUN_PHASES = [
  'UNDERSTANDING',
  'PLANNING',
  'AWAITING_GATE2',
  'EXECUTING',
  'VERIFYING',
  'DIAGNOSING',
  'CORRECTING',
  'EXPLAINING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type AgentRunPhase = (typeof AGENT_RUN_PHASES)[number];

export const AGENT_RUN_STATUSES = [
  'RUNNING',
  'AWAITING_GATE2',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_RUN_TERMINAL_PHASES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;

export type AgentRunTerminalPhase = (typeof AGENT_RUN_TERMINAL_PHASES)[number];

/** References to existing P0 workflow identities only — never authoritative plans or approvals. */
export interface AgentRunReferences {
  readonly investigationId?: string;
  readonly featurePlanId?: string;
  readonly preparationId?: string;
  readonly workflowId?: string;
  readonly correctionWorkflowId?: string;
}

export interface AgentRun {
  readonly schemaVersion: typeof AGENT_RUN_SCHEMA_VERSION;
  readonly runId: string;
  readonly projectId: string;
  /** Operator goal text (bounded); must not contain secrets. */
  readonly goal: string;
  readonly phase: AgentRunPhase;
  readonly status: AgentRunStatus;
  readonly references: AgentRunReferences;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAgentRunInput {
  readonly runId: string;
  readonly projectId: string;
  readonly goal: string;
  readonly createdAt: string;
  readonly references?: AgentRunReferences;
}

export class AgentRunError extends Error {
  constructor(
    readonly code:
      | 'INVALID_TRANSITION'
      | 'TERMINAL_STATE'
      | 'INVALID_GOAL'
      | 'INVALID_REFERENCE'
      | 'NOT_FOUND'
      | 'PERSISTENCE_FAILED'
      | 'CORRUPT_STATE',
    message: string,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}

export const AGENT_RUN_GOAL_MAX_CHARS = 4_000 as const;
export const AGENT_RUN_ID_MAX_CHARS = 128 as const;
export const AGENT_RUN_REFERENCE_ID_MAX_CHARS = 128 as const;
