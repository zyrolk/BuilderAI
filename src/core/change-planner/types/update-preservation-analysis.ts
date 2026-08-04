import type { ArtifactChecksum } from '../../response-processor';

import type {
  HtmlStructuredAnalysis,
  StructuredHtmlAnalysisConfiguration,
} from './html-structured-analysis';
import type { CrossFileReferenceRisk } from './update-preservation';

export type { CrossFileReferenceRisk };

export interface LargeDeletionSignal {
  readonly linesDeletedRatio: number;
  readonly linesAddedRatio: number;
  readonly isSuspicious: boolean;
}

export interface UpdatePreservationAnalysisInput {
  readonly logicalPath: string;
  readonly baselineContent: string;
  readonly proposedContent: string;
  /**
   * Optional unchanged sibling JS sources for narrow cross-file literal reference checks.
   * Workspace scanning and orchestration belong to Slice 2; callers supply content here.
   */
  readonly siblingJsContents?: readonly {
    readonly logicalPath: string;
    readonly content: string;
  }[];
  readonly structuredHtmlConfiguration?: StructuredHtmlAnalysisConfiguration;
  readonly elevatedChurnThreshold?: number;
}

export interface UpdatePreservationAnalysisResult {
  readonly logicalPath: string;
  readonly baselineContentChecksum: ArtifactChecksum;
  readonly baselineBytes: number;
  readonly proposedBytes: number;
  readonly baselineLines: number;
  readonly proposedLines: number;
  readonly linesAdded: number;
  readonly linesDeleted: number;
  readonly linesUnchanged: number;
  readonly churnRatio: number;
  readonly similarityRatio: number;
  readonly removedHtmlIds: readonly string[];
  readonly addedHtmlIds: readonly string[];
  readonly removedAccessibilityAttributes: readonly string[];
  readonly crossFileReferenceRisks: readonly CrossFileReferenceRisk[];
  readonly largeDeletionSignal: LargeDeletionSignal;
  readonly structuredAnalysis?: HtmlStructuredAnalysis;
}
