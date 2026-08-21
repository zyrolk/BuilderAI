import type { InvestigationConfidence } from '../investigation/investigation.types';

export const EXTERNAL_TARGET_PROJECT_MEMORY_SCHEMA_VERSION = 1 as const;

export const PROJECT_MEMORY_RECORD_CATEGORIES = [
  'DECISION',
  'COMPLETED_WORK',
  'INVESTIGATION',
  'FINDING',
] as const;

export type ProjectMemoryRecordCategory = (typeof PROJECT_MEMORY_RECORD_CATEGORIES)[number];

export const PROJECT_MEMORY_RECORD_STATUSES = ['ACTIVE', 'SUPERSEDED'] as const;
export type ProjectMemoryRecordStatus = (typeof PROJECT_MEMORY_RECORD_STATUSES)[number];

export const PROJECT_MEMORY_SOURCES = [
  'OPERATOR',
  'INVESTIGATION_SAVE',
  'VERIFIED_APPLY',
  'FEATURE_TASK',
] as const;

export type ProjectMemorySource = (typeof PROJECT_MEMORY_SOURCES)[number];

export interface ProjectMemoryRecordBase {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly summary: string;
  readonly supportingPaths: readonly string[];
  readonly source: ProjectMemorySource;
  readonly tags?: readonly string[];
  readonly status?: ProjectMemoryRecordStatus;
}

export interface ProjectMemoryDecision extends ProjectMemoryRecordBase {
  readonly category: 'DECISION';
}

export interface ProjectMemoryCompletedWork extends ProjectMemoryRecordBase {
  readonly category: 'COMPLETED_WORK';
  readonly preparationId?: string;
  readonly verificationStatus?: 'PASSED';
  readonly workflowId?: string;
  readonly changePlanDigest?: string;
  readonly verificationSummary?: string;
  readonly correctionSummary?: string;
  readonly completedAt?: string;
}

export interface ProjectMemoryInvestigation extends ProjectMemoryRecordBase {
  readonly category: 'INVESTIGATION';
  readonly investigationId: string;
  readonly confidence: InvestigationConfidence;
  readonly likelyRootCause?: string;
  readonly affectedAreas: readonly string[];
  readonly recommendedNextStepSummary?: string;
}

export interface ProjectMemoryFinding extends ProjectMemoryRecordBase {
  readonly category: 'FINDING';
}

export type ProjectMemoryRecord =
  | ProjectMemoryDecision
  | ProjectMemoryCompletedWork
  | ProjectMemoryInvestigation
  | ProjectMemoryFinding;

export interface ExternalTargetProjectMemory {
  readonly schemaVersion: typeof EXTERNAL_TARGET_PROJECT_MEMORY_SCHEMA_VERSION;
  readonly projectId: string;
  readonly updatedAt: string;
  readonly decisions: readonly ProjectMemoryDecision[];
  readonly completedWork: readonly ProjectMemoryCompletedWork[];
  readonly investigations: readonly ProjectMemoryInvestigation[];
  readonly findings: readonly ProjectMemoryFinding[];
}

export interface ProjectMemoryRelevantRecord {
  readonly record: ProjectMemoryRecord;
  readonly score: number;
  readonly potentiallyStale: boolean;
}

export interface ProjectMemoryContextSelection {
  readonly records: readonly ProjectMemoryRelevantRecord[];
  readonly renderedText: string;
  readonly truncated: boolean;
}

export class ProjectMemoryValidationError extends Error {
  constructor(readonly issues: readonly { readonly path: string; readonly message: string }[]) {
    super(
      issues.map(({ path, message }) => `${path}: ${message}`).join('; ') ||
        'Project memory validation failed.',
    );
    this.name = 'ProjectMemoryValidationError';
  }
}

export class ProjectMemoryPersistenceError extends Error {
  constructor(
    readonly code: 'PROJECT_MISMATCH' | 'INVALID_PATH' | 'SECRET_CONTENT' | 'UNSUPPORTED_PROFILE',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectMemoryPersistenceError';
  }
}
