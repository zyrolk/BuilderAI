import type { WORKFLOW_LEDGER_SCHEMA_VERSION } from './workflow-event.types';

export const WORKFLOW_CLASSIFICATIONS = [
  'RESUMABLE',
  'WAITING_FOR_APPROVAL',
  'RECOVERY_REQUIRED',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type WorkflowClassification = (typeof WORKFLOW_CLASSIFICATIONS)[number];

export const WORKFLOW_STATES = [
  'CREATED',
  'INVESTIGATING',
  'PREPARING',
  'AWAITING_APPROVAL',
  'APPLYING',
  'VERIFYING',
  'CORRECTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'RECOVERY_REQUIRED',
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export interface WorkflowManifest {
  readonly schemaVersion: typeof WORKFLOW_LEDGER_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly projectId: string;
  readonly repositoryRoot: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workflowState: WorkflowState;
  readonly classification: WorkflowClassification;
  readonly requestProvenance?: WorkflowRequestProvenance;
  readonly investigationProvenance?: WorkflowInvestigationProvenance;
  readonly prepareProvenance?: WorkflowPrepareProvenance;
  readonly gate2Provenance?: WorkflowGate2Provenance;
  readonly approvalProvenance?: WorkflowApprovalProvenance;
  readonly applyProvenance?: WorkflowApplyProvenance;
  readonly verificationProvenance?: WorkflowVerificationProvenance;
  readonly correctionProvenance?: WorkflowCorrectionProvenance;
  readonly baselineDigest?: string;
  readonly preparationId?: string;
  readonly lastEventSequence: number;
  readonly lastEventDigest: string;
}

export interface WorkflowRequestProvenance {
  readonly originalRequest: string;
  readonly normalizedRequest?: string;
  readonly acceptanceCriteria?: string;
}

export interface WorkflowInvestigationProvenance {
  readonly investigationId: string;
  readonly investigationDigest: string;
  readonly evidenceReferences: readonly string[];
  readonly selectedPaths: readonly string[];
  readonly investigationStatus: string;
}

export interface WorkflowPrepareProvenance {
  readonly preparationId: string;
  readonly contextPackageDigest: string;
  readonly promptPackageDigest: string;
  readonly providerIdentity: string;
  readonly providerAttemptSummary: string;
  readonly changePlanDigest: string;
}

export interface WorkflowGate2Provenance {
  readonly preparationId: string;
  readonly diffDigest: string;
  readonly changePlanDigest: string;
  readonly baselineDigest: string;
}

export interface WorkflowApprovalProvenance {
  readonly preparationId: string;
  readonly changePlanDigest: string;
  readonly diffDigest: string;
  readonly baselineDigest: string;
  readonly approvedAt: string;
  readonly approvalIdentity: string;
  readonly expiresAt: string;
}

export interface WorkflowApplyProvenance {
  readonly applyStartedAt?: string;
  readonly applyCompletedAt?: string;
  readonly applyResult?: string;
  readonly recoveryState?: string;
}

export interface WorkflowVerificationProvenance {
  readonly verificationPlanDigest?: string;
  readonly verificationResult?: string;
  readonly runtimeBrowserResult?: string;
  readonly completionState?: string;
}

export interface WorkflowCorrectionProvenance {
  readonly correctionSessionIds: readonly string[];
  readonly attemptNumber: number;
  readonly correctionDiagnosticsDigest?: string;
  readonly correctionChangePlanDigest?: string;
  readonly correctionResult?: string;
}
