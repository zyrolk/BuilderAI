import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { Gate2ReviewProjection } from '../gate2-review';
import type { CorrectionLoopService } from '../correction-loop';
import type { WorkspaceInvestigation } from '../investigation/investigation.types';
import type { WorkspaceRequestSecurityEvidence } from '../workspace-authorization.types';
import type { WorkspaceCompletion, WorkspacePreparation } from '../workspace-runtime.types';
import type { AgentRun, AgentRunPhase, AgentRunStatus } from './agent-run.types';
import type { AgentRunService } from './agent-run.service';
import type { ExplainArtifact } from './explain-artifact.types';
import type { ExplainArtifactPersistence } from './explain-artifact.persistence';

/** Bounded, secret-free explanation assembled from existing evidence only. */
export interface AgentRunExplanation {
  readonly runId: string;
  readonly projectId: string;
  readonly goal: string;
  readonly phase: AgentRunPhase;
  readonly status: AgentRunStatus;
  readonly references: AgentRun['references'];
  readonly preparationOutcome?: string;
  readonly applyStatus?: string;
  readonly verificationStatus?: string;
  readonly correctionState?: string;
  readonly summary: string;
}

export interface AgentOperatingStartResult {
  readonly run: AgentRun;
  readonly investigation: WorkspaceInvestigation;
}

export interface AgentOperatingPlanResult {
  readonly run: AgentRun;
  /** Gate 2 review material only — ChangePlan remains server-held in preparation store. */
  readonly gate2Review: Gate2ReviewProjection;
  readonly preparationId: string;
  readonly expiresAt: string;
  readonly applyAuthorizationToken?: string;
}

export interface AgentOperatingGate2PauseResult {
  readonly run: AgentRun;
  readonly gate2Review: Gate2ReviewProjection;
  readonly preparationId: string;
  readonly expiresAt: string;
  readonly applyAuthorizationToken?: string;
}

export interface AgentOperatingExecuteResult {
  readonly run: AgentRun;
  readonly completion: WorkspaceCompletion;
}

export interface AgentOperatingFailureResult {
  readonly run: AgentRun;
  readonly completion: WorkspaceCompletion;
  readonly correctionWorkflowId: string;
  readonly canPrepareCorrection: boolean;
}

export interface AgentOperatingExplainResult {
  readonly run: AgentRun;
  readonly explanation: AgentRunExplanation;
  readonly explain: ExplainArtifact;
}

export interface AgentOperatingInvestigationPort {
  investigate(request: string): Promise<WorkspaceInvestigation>;
  resolveInvestigationHandoff(investigationId: string): unknown;
}

export interface AgentOperatingRuntimePort {
  prepare(
    request: string,
    iterationFeedbackInput?: unknown,
    cancellation?: ExecutionCancellationToken,
  ): Promise<WorkspacePreparation>;
  approveAndApply(
    preparationId: string,
    approved: boolean,
    evidence?: WorkspaceRequestSecurityEvidence,
    cancellation?: ExecutionCancellationToken,
  ): Promise<WorkspaceCompletion>;
}

export interface AgentOperatingDependencies {
  readonly projectId: string;
  readonly agentRuns: AgentRunService;
  readonly explainArtifacts: ExplainArtifactPersistence;
  readonly investigation: AgentOperatingInvestigationPort;
  readonly runtime: AgentOperatingRuntimePort;
  readonly correction: CorrectionLoopService;
  readonly ids: { generate(): string };
  readonly clock: { now(): Date };
}

/** Process-local Gate 2 / completion evidence — never persisted on AgentRun. */
export interface AgentRunEphemeralEvidence {
  readonly gate2Review: Gate2ReviewProjection;
  readonly preparationId: string;
  readonly expiresAt: string;
  readonly applyAuthorizationToken?: string;
  readonly preparationOutcome?: string;
  readonly completion?: WorkspaceCompletion;
  readonly correctionCanPrepare?: boolean;
  /** Count of pauseAtGate2 observations in this process. */
  readonly gate2CyclesObserved?: number;
}

export interface AgentOperatingExplainArtifactResult {
  readonly run: AgentRun;
  readonly explain: ExplainArtifact;
  /** True when returned from durable storage rather than live assembly. */
  readonly persisted: boolean;
}
