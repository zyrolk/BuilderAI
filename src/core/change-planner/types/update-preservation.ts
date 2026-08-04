import type { ArtifactChecksum } from '../../response-processor';

export interface CrossFileReferenceRisk {
  readonly removedId: string;
  readonly referencingLogicalPath: string;
}

export type PreservationFindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type PreservationFindingCode =
  | 'PRESERVATION_BASELINE_UNAVAILABLE'
  | 'PRESERVATION_HIGH_CHURN_REWRITE'
  | 'PRESERVATION_ELEVATED_CHURN'
  | 'PRESERVATION_REMOVED_HTML_ID'
  | 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE'
  | 'PRESERVATION_CROSS_FILE_REFERENCE_RISK'
  | 'PRESERVATION_LARGE_DELETION';

export interface UpdatePreservationFinding {
  readonly code: PreservationFindingCode;
  readonly severity: PreservationFindingSeverity;
  readonly message: string;
}

export interface UpdatePreservationAssessment {
  readonly baselineContentChecksum?: ArtifactChecksum;
  readonly baselineBytes?: number;
  readonly proposedBytes?: number;
  readonly baselineLines?: number;
  readonly proposedLines?: number;
  readonly linesAdded?: number;
  readonly linesDeleted?: number;
  readonly linesUnchanged?: number;
  readonly churnRatio?: number;
  readonly similarityRatio?: number;
  readonly removedHtmlIds?: readonly string[];
  readonly addedHtmlIds?: readonly string[];
  readonly removedAccessibilityAttributes?: readonly string[];
  readonly crossFileReferenceRisks?: readonly CrossFileReferenceRisk[];
  readonly findings: readonly UpdatePreservationFinding[];
}
