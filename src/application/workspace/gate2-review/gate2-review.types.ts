import type { ChangeOperationKind } from '../../../core/change-planner';
import type { ArtifactChecksum } from '../../../core/response-processor';

export const GATE2_REVIEW_PROJECTION_SCHEMA_VERSION = 1 as const;

export const GATE2_DIFF_FORMATS = ['UNIFIED', 'UNAVAILABLE', 'PROTECTED'] as const;
export type Gate2DiffFormat = (typeof GATE2_DIFF_FORMATS)[number];

export const GATE2_OPERATION_LABELS = ['NEW FILE', 'DELETE FILE', 'UPDATE FILE'] as const;
export type Gate2OperationLabel = (typeof GATE2_OPERATION_LABELS)[number];

export interface Gate2OperationDiff {
  readonly operationId: string;
  readonly kind: ChangeOperationKind;
  readonly logicalPath: string;
  readonly label: Gate2OperationLabel;
  readonly format: Gate2DiffFormat;
  readonly unifiedDiff?: string;
  readonly truncated: boolean;
  readonly truncationMessage?: string;
  readonly baselineContentChecksum?: ArtifactChecksum;
  readonly proposedContentChecksum?: ArtifactChecksum;
  readonly lineCount: number;
  readonly characterCount: number;
}

export interface Gate2ReviewProjection {
  readonly schemaVersion: typeof GATE2_REVIEW_PROJECTION_SCHEMA_VERSION;
  readonly operationDiffs: readonly Gate2OperationDiff[];
  readonly totalCharacterCount: number;
  readonly truncated: boolean;
  readonly truncationMessage?: string;
}
