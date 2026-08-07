export const EXTERNAL_TARGET_READINESS_SCHEMA_VERSION = 1 as const;

export const EXTERNAL_TARGET_READINESS_STATUSES = [
  'READY',
  'READY_WITH_WARNINGS',
  'BLOCKED',
] as const;

export type ExternalTargetReadinessStatus = (typeof EXTERNAL_TARGET_READINESS_STATUSES)[number];

export const READINESS_ISSUE_SEVERITIES = ['BLOCKER', 'WARNING'] as const;

export type ReadinessIssueSeverity = (typeof READINESS_ISSUE_SEVERITIES)[number];

export const PROTECTED_AREA_CLASSIFICATIONS = ['NEVER_EXPOSE', 'MUTATION_PROTECTED'] as const;

export type ProtectedAreaClassification = (typeof PROTECTED_AREA_CLASSIFICATIONS)[number];

export interface ReadinessIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: ReadinessIssueSeverity;
  readonly path?: string;
  readonly remediation?: string;
}

export interface ExternalTargetProtectedAreaSummary {
  readonly path: string;
  readonly classification: ProtectedAreaClassification;
}

export interface ExternalTargetVerificationCapabilities {
  readonly build: boolean;
  readonly test: boolean;
  readonly lint: boolean;
  readonly typecheck: boolean;
}

export interface ExternalTargetReadiness {
  readonly schemaVersion: typeof EXTERNAL_TARGET_READINESS_SCHEMA_VERSION;
  readonly status: ExternalTargetReadinessStatus;
  readonly profile: 'EXTERNAL_TARGET';
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRootDisplay: string;
  readonly runtimeConnected: boolean;
  readonly sourceRoots: readonly string[];
  readonly testRoots: readonly string[];
  readonly governanceDocuments: readonly string[];
  readonly indexedFileCount: number;
  readonly protectedAreas: readonly ExternalTargetProtectedAreaSummary[];
  readonly verification: ExternalTargetVerificationCapabilities;
  readonly warnings: readonly ReadinessIssue[];
  readonly blockers: readonly ReadinessIssue[];
}
