/**
 * P1-B B1 Tool Registry contracts (ADR-037).
 *
 * Read-only capability catalog + execution shapes. No mutation, terminal, Git write,
 * MCP, browser, or provider tool-calling loop.
 */

import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { AgentRunPhase } from '../agent-operating/agent-run.types';
import type {
  WorkspaceAuthorizationAction,
  WorkspacePrincipal,
  WorkspaceRequestSecurityEvidence,
  WorkspaceSecurityProfile,
} from '../workspace-authorization.types';

export const TOOL_REGISTRY_SCHEMA_VERSION = 1 as const;

export const TOOL_CAPABILITY_CLASSES = [
  'SEARCH',
  'READ',
  'INSPECT',
  'PLAN',
  'VERIFY',
  'BROWSER',
  'MUTATE',
  'GIT_READ',
  'WEB',
] as const;

export type ToolCapabilityClass = (typeof TOOL_CAPABILITY_CLASSES)[number];

/** B1-allowed capability classes only. */
export const B1_ALLOWED_CAPABILITY_CLASSES = ['SEARCH', 'READ', 'INSPECT'] as const;
export type B1AllowedCapabilityClass = (typeof B1_ALLOWED_CAPABILITY_CLASSES)[number];

export const TOOL_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type ToolRiskLevel = (typeof TOOL_RISK_LEVELS)[number];

export const TOOL_APPROVAL_REQUIREMENTS = ['NONE', 'GATE2', 'OPERATOR'] as const;
export type ToolApprovalRequirement = (typeof TOOL_APPROVAL_REQUIREMENTS)[number];

export const TOOL_EVIDENCE_POLICIES = ['SUMMARY', 'DIGEST', 'NONE'] as const;
export type ToolEvidencePolicy = (typeof TOOL_EVIDENCE_POLICIES)[number];

export const TOOL_AUDIT_POLICIES = ['NONE', 'DIGEST', 'LEDGER'] as const;
export type ToolAuditPolicy = (typeof TOOL_AUDIT_POLICIES)[number];

export const TOOL_RESULT_STATUSES = [
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REJECTED_BY_POLICY',
  'TIMEOUT',
] as const;
export type ToolResultStatus = (typeof TOOL_RESULT_STATUSES)[number];

/** Descriptive schema object for documentation and light validation hints. */
export type ToolJsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDefinition {
  readonly toolId: string;
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ToolJsonSchema;
  readonly outputSchema: ToolJsonSchema;
  readonly capabilityClass: ToolCapabilityClass;
  readonly readOnly: boolean;
  readonly riskLevel: ToolRiskLevel;
  readonly authorizationAction: WorkspaceAuthorizationAction;
  readonly requiresGate2: boolean;
  readonly approvalRequirement: ToolApprovalRequirement;
  readonly workspaceScoped: boolean;
  readonly timeoutMs: number;
  readonly supportsCancellation: boolean;
  readonly evidencePolicy: ToolEvidencePolicy;
  readonly auditPolicy: ToolAuditPolicy;
  /** AgentRun phases that may invoke this tool. */
  readonly allowedPhases: readonly AgentRunPhase[];
}

export interface ToolCallIntent {
  readonly callId: string;
  readonly toolId: string;
  readonly args: unknown;
  readonly idempotencyKey?: string;
}

export interface ToolExecutionContext {
  readonly runId: string;
  readonly projectId: string;
  /** Absolute project root used by INSPECT / filesystem-backed tools. */
  readonly projectRoot: string;
  readonly phase: AgentRunPhase;
  readonly principal: WorkspacePrincipal;
  readonly securityProfile: WorkspaceSecurityProfile;
  readonly securityEvidence: WorkspaceRequestSecurityEvidence;
  readonly cancellation: ExecutionCancellationToken;
  readonly preparationId?: string;
  readonly workflowId?: string;
  readonly investigationId?: string;
  readonly correctionWorkflowId?: string;
  readonly featurePlanId?: string;
  readonly correlationId?: string;
  /** Optional per-call timeout override (capped by tool definition). */
  readonly timeoutMs?: number;
}

export type ToolJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly ToolJsonValue[]
  | { readonly [key: string]: ToolJsonValue };

export interface ToolResult {
  readonly schemaVersion: typeof TOOL_REGISTRY_SCHEMA_VERSION;
  readonly callId: string;
  readonly toolId: string;
  readonly status: ToolResultStatus;
  readonly summary: string;
  readonly structured?: ToolJsonValue;
  readonly digests?: {
    readonly structuredDigest?: string;
  };
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

/** Raw handler output before sanitization / digest attachment. */
export interface ToolHandlerRawResult {
  readonly summary: string;
  readonly structured?: ToolJsonValue;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export interface ToolHandler {
  readonly definition: ToolDefinition;
  execute(args: unknown, context: ToolExecutionContext): Promise<ToolHandlerRawResult>;
}

export class ToolRegistryError extends Error {
  constructor(
    readonly code:
      | 'INVALID_DEFINITION'
      | 'DUPLICATE_TOOL'
      | 'UNKNOWN_TOOL'
      | 'POLICY_REJECTED'
      | 'INVALID_ARGS'
      | 'EXECUTION_FAILED'
      | 'CANCELLED'
      | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'ToolRegistryError';
  }
}

export const TOOL_ID_MAX_CHARS = 64 as const;
export const TOOL_SUMMARY_MAX_CHARS = 512 as const;
export const TOOL_STRUCTURED_MAX_CHARS = 24_000 as const;
export const TOOL_EXCERPT_MAX_CHARS = 8_192 as const;
export const TOOL_SEARCH_QUERY_MAX = 12 as const;
export const TOOL_SEARCH_QUERY_MAX_CHARS = 120 as const;
