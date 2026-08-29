/**
 * P1-B B6 Bounded Server-Owned Agent Tool Loop (ADR-042).
 * Tool execution is a server capability, not a provider capability.
 */

import type { AgentRunPhase } from '../agent-operating/agent-run.types';
import type { ToolCapabilityClass, ToolResult } from '../tool-registry/tool-registry.types';

/** Current persisted agent-loop evidence schema (ADR-047 v2 adds optional planningProjection). */
export const AGENT_LOOP_SCHEMA_VERSION = 2 as const;

/** Legacy v1 evidence remains readable without planningProjection. */
export const AGENT_LOOP_LEGACY_SCHEMA_VERSION = 1 as const;

export type AgentLoopPersistedSchemaVersion =
  typeof AGENT_LOOP_SCHEMA_VERSION | typeof AGENT_LOOP_LEGACY_SCHEMA_VERSION;

export const OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION = 1 as const;

/** Bounded server-derived planning extract (ADR-047). DATA only — never authority. */
export interface OperatorToolPlanningProjection {
  readonly projectionSchemaVersion: typeof OPERATOR_TOOL_PLANNING_PROJECTION_SCHEMA_VERSION;
  readonly sourceRunId: string;
  readonly toolId: string;
  readonly intentId: string;
  readonly phase: AgentRunPhase;
  readonly status: AgentLoopTurnStatus;
  readonly recordedAt: string;

  readonly pathHints?: readonly string[];
  readonly existingPathHints?: readonly string[];
  readonly candidatePathHints?: readonly string[];

  readonly searchHitCount?: number;
  readonly relevantFileCount?: number;
  readonly readinessStatus?: string;
  readonly truncated?: boolean;

  readonly provenance: 'OPERATOR_TOOL_TURN';
  readonly summaryDigest: string;
}

export const DEFAULT_AGENT_LOOP_BUDGETS = {
  maxToolCallsPerRun: 40,
  maxIdenticalToolArgsRepeats: 2,
  maxProviderTurnsPerRun: 12,
  /** Hard wall-clock: 15 minutes (within ADR-042 15–20 minute band). */
  hardWallClockMs: 15 * 60 * 1_000,
  maxB4VerificationCallsPerRun: 6,
  /** ADR-043: dedicated browser observation call budget. */
  maxBrowserObservationCallsPerRun: 3,
  concurrentToolExecutions: 1,
} as const;

export type AgentLoopBudgets = {
  readonly maxToolCallsPerRun: number;
  readonly maxIdenticalToolArgsRepeats: number;
  readonly maxProviderTurnsPerRun: number;
  readonly hardWallClockMs: number;
  readonly maxB4VerificationCallsPerRun: number;
  readonly maxBrowserObservationCallsPerRun: number;
  readonly concurrentToolExecutions: number;
};

/** Provider-emitted structured intent — never authoritative for approvals or roots. */
export interface ProviderStructuredToolIntent {
  readonly toolId: string;
  readonly arguments?: unknown;
  readonly intentId: string;
}

export const PROVIDER_AUTHORITY_FIELD_NAMES = [
  'approved',
  'applyAuthorizationToken',
  'changePlan',
  'gate2Review',
  'operatorApproved',
  'browserObservationApproved',
  'repositoryRoot',
  'gitExecutable',
  'cwd',
  'env',
  'argv',
  'command',
  'shell',
  'bearerToken',
  'csrfToken',
  'accessToken',
  'baselineDigest',
  // Binding / lifecycle forgery (ADR-046) — server-owned only.
  'projectId',
  'runId',
  'phase',
  'principalId',
] as const;

export type AgentLoopTurnStatus =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REJECTED_BY_POLICY'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'BUDGET_EXHAUSTED'
  | 'REPLAYED';

export interface AgentLoopBudgetSnapshot {
  readonly toolCalls: number;
  readonly providerTurns: number;
  readonly b4VerificationCalls: number;
  readonly browserObservationCalls: number;
  readonly startedAtMs: number;
  readonly identicalRepeatCounts: Readonly<Record<string, number>>;
  readonly completedIntentIds: readonly string[];
}

export interface BoundedToolEvidenceRecord {
  readonly schemaVersion: AgentLoopPersistedSchemaVersion;
  readonly runId: string;
  readonly projectId: string;
  readonly phase: AgentRunPhase;
  readonly toolId: string;
  readonly intentId: string;
  readonly status: AgentLoopTurnStatus;
  readonly recordedAt: string;
  readonly summaryDigest: string;
  readonly planningProjection?: OperatorToolPlanningProjection;
  readonly resultStatus?: ToolResult['status'];
  readonly errorCode?: string;
  readonly preparationId?: string;
  readonly workflowId?: string;
}

export interface AgentLoopPersistedState {
  readonly schemaVersion: AgentLoopPersistedSchemaVersion;
  readonly runId: string;
  readonly projectId: string;
  readonly budget: AgentLoopBudgetSnapshot;
  readonly evidence: readonly BoundedToolEvidenceRecord[];
  readonly stoppedReason?: string;
  readonly updatedAt: string;
}

export interface AgentLoopTurnResult {
  readonly intentId: string;
  readonly toolId: string;
  readonly status: AgentLoopTurnStatus;
  readonly toolResult?: ToolResult;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly evidence: BoundedToolEvidenceRecord;
  readonly budget: AgentLoopBudgetSnapshot;
  readonly replayed: boolean;
}

export interface AgentLoopProviderTurnResult {
  readonly turnIndex: number;
  readonly results: readonly AgentLoopTurnResult[];
  readonly budget: AgentLoopBudgetSnapshot;
  readonly stopped: boolean;
  readonly stopReason?: string;
}

export class AgentLoopError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentLoopError';
  }
}

/** Autonomous-loop capability allowlist by phase (ADR-042). GIT_WRITE never allowed here. */
export const AUTONOMOUS_LOOP_PHASE_CAPABILITIES: Readonly<
  Record<AgentRunPhase, readonly ToolCapabilityClass[] | null>
> = {
  UNDERSTANDING: ['SEARCH', 'READ', 'INSPECT', 'VERIFY'],
  PLANNING: ['SEARCH', 'READ', 'INSPECT', 'PLAN'],
  AWAITING_GATE2: ['SEARCH', 'READ', 'INSPECT', 'GIT_READ'],
  EXECUTING: null,
  VERIFYING: ['VERIFY', 'INSPECT', 'GIT_READ', 'BROWSER'],
  DIAGNOSING: ['SEARCH', 'READ', 'INSPECT', 'VERIFY', 'BROWSER'],
  CORRECTING: ['SEARCH', 'READ', 'INSPECT', 'PLAN'],
  EXPLAINING: null,
  COMPLETED: null,
  FAILED: null,
  CANCELLED: null,
};
