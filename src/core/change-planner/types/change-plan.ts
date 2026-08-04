import type {
  ArtifactChecksum,
  ResponseArtifactType,
  ResponseMetadata,
} from '../../response-processor';
import type { UpdatePreservationAssessment } from './update-preservation';

export const PROJECT_CHANGE_PLAN_SCHEMA_VERSION = 1 as const;
export const CHANGE_OPERATION_KINDS = ['CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE'] as const;
export const CHANGE_RISK_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type ChangeOperationKind = (typeof CHANGE_OPERATION_KINDS)[number];
export type ChangeRiskSeverity = (typeof CHANGE_RISK_SEVERITIES)[number];

interface ChangeOperationBase {
  readonly operationId: string;
  readonly kind: ChangeOperationKind;
  readonly logicalPath: string;
  readonly artifactType: ResponseArtifactType;
  readonly description: string;
  readonly sourceChecksum: ArtifactChecksum;
  readonly sourceSizeBytes: number;
}

export interface CreateFileOperation extends ChangeOperationBase {
  readonly kind: 'CREATE_FILE';
  readonly content: string;
}

export interface UpdateFileOperation extends ChangeOperationBase {
  readonly kind: 'UPDATE_FILE';
  readonly content: string;
  readonly baselineContentChecksum?: ArtifactChecksum;
  readonly preservation?: UpdatePreservationAssessment;
}

export interface DeleteFileOperation extends ChangeOperationBase {
  readonly kind: 'DELETE_FILE';
}

export type ProjectChangeOperation =
  CreateFileOperation | UpdateFileOperation | DeleteFileOperation;

export interface ProjectChangeSet {
  readonly operations: readonly ProjectChangeOperation[];
}

export interface ProjectChangePlanSource {
  readonly responsePackageSchemaVersion: number;
  readonly executionId: string;
}

export interface ProjectChangeRisk {
  readonly code: string;
  readonly severity: ChangeRiskSeverity;
  readonly message: string;
  readonly operationIds: readonly string[];
}

export interface ProjectChangeWarning {
  readonly code: string;
  readonly message: string;
  readonly operationIds: readonly string[];
}

export interface ProjectChangePlanSummary {
  readonly filesCreated: readonly string[];
  readonly filesUpdated: readonly string[];
  readonly filesDeleted: readonly string[];
  readonly totalOperations: number;
  readonly warnings: readonly string[];
}

export interface ProjectChangePlan {
  readonly schemaVersion: typeof PROJECT_CHANGE_PLAN_SCHEMA_VERSION;
  readonly source: ProjectChangePlanSource;
  readonly changeSet: ProjectChangeSet;
  readonly summary: ProjectChangePlanSummary;
  readonly risks: readonly ProjectChangeRisk[];
  readonly warnings: readonly ProjectChangeWarning[];
  readonly metadata: ResponseMetadata;
}

export type ChangePlanValidationCode =
  | 'CONFLICTING_OPERATIONS'
  | 'DUPLICATE_OPERATION'
  | 'INVALID_CHANGE_PLAN'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_METADATA'
  | 'INVALID_REFERENCE'
  | 'UNSUPPORTED_CHANGE'
  | 'UNSUPPORTED_PLAN_VERSION';

export interface ChangePlanValidationIssue {
  readonly code: ChangePlanValidationCode;
  readonly path: string;
  readonly message: string;
}
