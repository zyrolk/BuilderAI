import type { AgentRun, AgentRunPhase, AgentRunStatus } from './agent-run.types';

export const EXPLAIN_ARTIFACT_SCHEMA_VERSION = 1 as const;

export const EXPLAIN_EVIDENCE_AVAILABILITY = ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'] as const;
export type ExplainEvidenceAvailability = (typeof EXPLAIN_EVIDENCE_AVAILABILITY)[number];

/** Explicit availability — never invent missing evidence. */
export interface ExplainAvailability {
  readonly status: ExplainEvidenceAvailability;
  readonly reason?: string;
}

export interface ExplainUnderstoodSection {
  readonly availability: ExplainAvailability;
  readonly goal: string;
  readonly investigationId?: string;
}

export interface ExplainPlanSection {
  readonly availability: ExplainAvailability;
  readonly preparationId?: string;
  readonly preparationOutcome?: string;
  readonly plannedOperationCount?: number;
  readonly gate2CharacterCount?: number;
  readonly gate2Truncated?: boolean;
}

export interface ExplainChangesSection {
  readonly availability: ExplainAvailability;
  readonly applyStatus?: string;
  readonly createdFiles?: readonly string[];
  readonly updatedFiles?: readonly string[];
  readonly deletedFiles?: readonly string[];
  readonly skippedFiles?: readonly string[];
  readonly errorCodes?: readonly string[];
  readonly truncatedPathLists?: boolean;
}

export interface ExplainVerificationStageSummary {
  readonly stage: string;
  readonly status: string;
}

export interface ExplainVerificationSection {
  readonly availability: ExplainAvailability;
  readonly overallStatus?: string;
  readonly stages?: readonly ExplainVerificationStageSummary[];
  readonly findingCodes?: readonly string[];
}

export interface ExplainBrowserVerificationSection {
  readonly availability: ExplainAvailability;
  readonly overallStatus?: string;
  readonly serverStatus?: string;
  readonly browserStatus?: string;
  readonly routeCount?: number;
  readonly consoleErrorCount?: number;
  readonly pageExceptionCount?: number;
  readonly failedRequestCount?: number;
}

export interface ExplainFailureItem {
  readonly source: 'APPLY' | 'VERIFICATION' | 'BROWSER' | 'CORRECTION' | 'RUN';
  readonly code?: string;
  readonly message?: string;
}

export interface ExplainCorrectionsSection {
  readonly availability: ExplainAvailability;
  readonly correctionWorkflowId?: string;
  readonly state?: string;
  readonly attempt?: number;
  readonly maximumAttempts?: number;
  readonly canPrepare?: boolean;
  readonly failureCategory?: string;
  readonly attemptHistoryCount?: number;
}

export interface ExplainApprovalsSection {
  readonly availability: ExplainAvailability;
  /** Observed Gate 2 pause cycles in this process or persisted artifact. */
  readonly gate2CyclesObserved?: number;
}

export interface ExplainFinalResult {
  readonly runPhase: AgentRunPhase;
  readonly runStatus: AgentRunStatus;
  readonly applyStatus?: string;
  readonly verificationStatus?: string;
  readonly browserVerificationStatus?: string;
}

export interface ExplainEvidenceReferences {
  readonly investigationId?: string;
  readonly featurePlanId?: string;
  readonly preparationId?: string;
  readonly workflowId?: string;
  readonly correctionWorkflowId?: string;
}

/**
 * Deterministic, secret-free explanation projection for an AgentRun.
 * Assembled from existing evidence only — never LLM-generated.
 */
export interface ExplainArtifact {
  readonly schemaVersion: typeof EXPLAIN_ARTIFACT_SCHEMA_VERSION;
  readonly runId: string;
  readonly projectId: string;
  readonly goal: string;
  readonly generatedAt: string;
  readonly understood: ExplainUnderstoodSection;
  readonly plan: ExplainPlanSection;
  readonly changes: ExplainChangesSection;
  readonly verification: ExplainVerificationSection;
  readonly browserVerification: ExplainBrowserVerificationSection;
  readonly failures: readonly ExplainFailureItem[];
  readonly corrections: ExplainCorrectionsSection;
  readonly approvals: ExplainApprovalsSection;
  readonly finalResult: ExplainFinalResult;
  readonly evidence: ExplainEvidenceReferences;
  /** Deterministic short text derived from fields above — not provider narrative. */
  readonly summary: string;
}

export type { AgentRun };
