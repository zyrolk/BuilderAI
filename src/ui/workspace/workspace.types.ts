import type { CorrectionLoopSession } from '../../application/workspace/correction-loop';
import type { IterationFeedback } from '../../application/workspace/iteration-feedback.types';
import type { FeaturePlan } from '../../application/workspace/feature-plan.types';
import type { ActivityHistory } from '../../application/workspace/activity-history.types';
import type { ExternalTargetProjectMemory } from '../../application/workspace/project-memory';
import type { Gate2ReviewProjection } from '../../application/workspace/gate2-review';
import type { WorkspaceInvestigation } from '../../application/workspace/investigation';
import type { ProjectChangePlan } from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponsePackage } from '../../core/response-processor';
import type { RuntimeBrowserVerificationReport } from '../../core/runtime-verification';
import type { VerificationReport } from '../../core/verification';
import { isCorrectionEligibleCompletion } from '../../application/workspace/correction-loop';

export interface PrepareWorkspaceOptions {
  readonly iterationFeedback?: unknown;
  readonly investigationId?: string;
  readonly featurePlanId?: string;
  readonly taskId?: string;
  readonly dependencyOverrides?: readonly string[];
  readonly correctionWorkflowId?: string;
}

export interface WorkspaceCompletionSnapshot {
  readonly applyResult: FileApplyResult;
  readonly verificationReport?: VerificationReport;
  readonly runtimeBrowserVerificationReport?: RuntimeBrowserVerificationReport;
  readonly sourcePreparationId?: string;
  readonly priorRequestSummary?: string;
  readonly featurePlanId?: string;
  readonly taskId?: string;
  readonly dependencyOverrides?: readonly string[];
}

export const WORKSPACE_PHASES = [
  'READY',
  'INVESTIGATING',
  'INVESTIGATION_COMPLETE',
  'PROCESSING_REQUEST',
  'AWAITING_APPROVAL',
  'APPLYING_CHANGES',
  'VERIFYING_PROJECT',
  'COMPLETED',
  'FAILED',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_CANCELLED',
  'OUTPUT_TRUNCATED',
  'INVALID_PROVIDER_RESPONSE',
  'INSUFFICIENT_EVIDENCE',
  'NO_CHANGE',
  'RECOVERY_REQUIRED',
  'BASELINE_CHANGED',
  'RESUMING_WORKFLOW',
  'WAITING_FOR_APPROVAL',
  'WORKFLOW_CANCELLED',
] as const;

export const RESULT_PANEL_TABS = [
  'RESPONSE_PACKAGE',
  'CHANGE_PLAN',
  'DIFF',
  'INVESTIGATION',
  'APPLY_RESULT',
  'VERIFICATION_REPORT',
] as const;

export type WorkspacePhase = (typeof WORKSPACE_PHASES)[number];
export type ResultPanelTab = (typeof RESULT_PANEL_TABS)[number];

export interface WorkspaceProjectView {
  readonly id: string;
  readonly name: string;
  readonly vision: string;
  readonly currentMilestone: string;
  readonly architectureStatus: string;
  readonly moduleCount: number;
  readonly completedSprintCount: number;
}

export interface PreparedWorkspaceChange {
  readonly responsePackage: ResponsePackage;
  readonly changePlan: ProjectChangePlan;
  readonly gate2Review?: Gate2ReviewProjection;
  readonly featurePlan?: FeaturePlan;
  readonly preparationId?: string;
  readonly sourcePreparationId?: string;
  readonly isCorrection?: boolean;
}

export interface Gate2CorrectionCapableWorkflow extends WorkspaceWorkflowPort {
  prepareGate2PreservationCorrection(
    request: string,
    changePlan: ProjectChangePlan,
    preparationId: string,
    operatorReason?: string,
  ): Promise<PreparedWorkspaceChange>;
}

export function supportsGate2Correction(
  workflow: WorkspaceWorkflowPort,
): workflow is Gate2CorrectionCapableWorkflow {
  return (
    'prepareGate2PreservationCorrection' in workflow &&
    typeof Reflect.get(workflow, 'prepareGate2PreservationCorrection') === 'function'
  );
}

export interface SaveInvestigationMemoryInput {
  readonly investigationId: string;
  readonly requestSummary?: string;
  readonly summary: string;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly likelyRootCause?: string;
  readonly affectedAreas: readonly string[];
  readonly recommendedNextSteps: readonly string[];
  readonly suggestedFixScope?: string;
}

export interface SaveOperatorMemoryInput {
  readonly category: 'DECISION' | 'FINDING';
  readonly summary: string;
  readonly supportingPaths?: readonly string[];
  readonly tags?: readonly string[];
}

export interface WorkspaceWorkflowPort {
  prepare(request: string, options?: PrepareWorkspaceOptions): Promise<PreparedWorkspaceChange>;
  investigate?(request: string): Promise<WorkspaceInvestigation>;
  apply(changePlan: ProjectChangePlan): Promise<FileApplyResult>;
  verify(applyResult: FileApplyResult): Promise<VerificationReport>;
  getCompletionSnapshot?(): WorkspaceCompletionSnapshot | undefined;
  startCorrection?(
    snapshot: WorkspaceCompletionSnapshot,
    workflowId: string,
    originalTaskSummary?: string,
  ): Promise<{
    readonly session: CorrectionLoopSession;
    readonly correctionRequest: string;
    readonly canPrepare: boolean;
    readonly iterationFeedback?: IterationFeedback;
  }>;
  rejectCorrection?(workflowId: string): Promise<CorrectionLoopSession>;
  recordCorrectionPrepared?(
    workflowId: string,
    preparationId: string,
    changePlan: ProjectChangePlan,
  ): Promise<CorrectionLoopSession>;
  recordCorrectionApplying?(workflowId: string): Promise<CorrectionLoopSession>;
  recordCorrectionVerified?(
    workflowId: string,
    snapshot: WorkspaceCompletionSnapshot,
  ): Promise<CorrectionLoopSession>;
  abortInFlight?(): void;
  loadActivityHistory?(): Promise<ActivityHistory>;
  loadProjectMemory?(): Promise<ExternalTargetProjectMemory>;
  saveInvestigationMemory?(
    input: SaveInvestigationMemoryInput,
  ): Promise<ExternalTargetProjectMemory>;
  saveOperatorMemory?(input: SaveOperatorMemoryInput): Promise<ExternalTargetProjectMemory>;
}

export function isCorrectionEligible(snapshot: WorkspaceCompletionSnapshot | undefined): boolean {
  if (snapshot === undefined) return false;
  return isCorrectionEligibleCompletion({
    applyResult: snapshot.applyResult,
    ...(snapshot.verificationReport === undefined
      ? {}
      : { verificationReport: snapshot.verificationReport }),
    ...(snapshot.runtimeBrowserVerificationReport === undefined
      ? {}
      : { runtimeBrowserVerificationReport: snapshot.runtimeBrowserVerificationReport }),
  });
}

export function isPartialApplyRecovery(snapshot: WorkspaceCompletionSnapshot | undefined): boolean {
  return snapshot?.applyResult.status === 'PARTIALLY_APPLIED';
}

export interface WorkspaceProviderAssistedDigest {
  readonly source: 'provider-structured-intent';
  readonly toolCalling: false;
  readonly proposedCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly rejections: readonly {
    readonly code: string;
    readonly message: string;
    readonly operatorAction: string;
    readonly intentIndex?: number;
    readonly intentId?: string;
    readonly toolId?: string;
  }[];
}

export class WorkspaceWorkflowError extends Error {
  readonly providerAssisted?: WorkspaceProviderAssistedDigest;

  constructor(code: string, message: string, providerAssisted?: WorkspaceProviderAssistedDigest) {
    super(message);
    this.name = 'WorkspaceWorkflowError';
    this.code = code;
    if (providerAssisted !== undefined) {
      this.providerAssisted = providerAssisted;
    }
  }

  readonly code: string;
}

export interface WorkspaceConversationEntry {
  readonly id: number;
  readonly author: 'USER' | 'BUILDER_AI';
  readonly message: string;
}
