import type { ProjectChangePlan } from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponsePackage } from '../../core/response-processor';
import type { VerificationReport } from '../../core/verification';

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
}

export interface WorkspaceWorkflowPort {
  prepare(request: string): Promise<PreparedWorkspaceChange>;
  apply(changePlan: ProjectChangePlan): Promise<FileApplyResult>;
  verify(applyResult: FileApplyResult): Promise<VerificationReport>;
}

export interface WorkspaceConversationEntry {
  readonly id: number;
  readonly author: 'USER' | 'BUILDER_AI';
  readonly message: string;
}
