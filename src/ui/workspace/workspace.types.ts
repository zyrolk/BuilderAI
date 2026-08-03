import type { FeaturePlan } from '../../application/workspace/feature-plan.types';
import type { ActivityHistory } from '../../application/workspace/activity-history.types';
import type { ProjectChangePlan } from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponsePackage } from '../../core/response-processor';
import type { VerificationReport } from '../../core/verification';

export interface PrepareWorkspaceOptions {
  readonly iterationFeedback?: unknown;
  readonly featurePlanId?: string;
  readonly taskId?: string;
  readonly dependencyOverrides?: readonly string[];
}

export interface WorkspaceCompletionSnapshot {
  readonly applyResult: FileApplyResult;
  readonly verificationReport?: VerificationReport;
  readonly sourcePreparationId?: string;
  readonly priorRequestSummary?: string;
  readonly featurePlanId?: string;
  readonly taskId?: string;
  readonly dependencyOverrides?: readonly string[];
}

export const WORKSPACE_PHASES = [
  'READY',
  'PROCESSING_REQUEST',
  'AWAITING_APPROVAL',
  'APPLYING_CHANGES',
  'VERIFYING_PROJECT',
  'COMPLETED',
  'FAILED',
] as const;

export const RESULT_PANEL_TABS = [
  'RESPONSE_PACKAGE',
  'CHANGE_PLAN',
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
  readonly featurePlan?: FeaturePlan;
}

export interface WorkspaceWorkflowPort {
  prepare(request: string, options?: PrepareWorkspaceOptions): Promise<PreparedWorkspaceChange>;
  apply(changePlan: ProjectChangePlan): Promise<FileApplyResult>;
  verify(applyResult: FileApplyResult): Promise<VerificationReport>;
  loadActivityHistory?(): Promise<ActivityHistory>;
}

export function isCorrectionEligible(snapshot: WorkspaceCompletionSnapshot | undefined): boolean {
  if (snapshot === undefined) return false;
  const { applyResult, verificationReport } = snapshot;
  if (applyResult.status === 'PARTIALLY_APPLIED') return true;
  if (applyResult.status === 'APPLIED' && verificationReport !== undefined) {
    return (
      verificationReport.status === 'FAILED' || verificationReport.status === 'PARTIALLY_PASSED'
    );
  }
  if (applyResult.status === 'FAILED' || applyResult.status === 'REJECTED') {
    return applyResult.errors.length > 0;
  }
  return false;
}

export class WorkspaceWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceWorkflowError';
  }
}

export interface WorkspaceConversationEntry {
  readonly id: number;
  readonly author: 'USER' | 'BUILDER_AI';
  readonly message: string;
}
