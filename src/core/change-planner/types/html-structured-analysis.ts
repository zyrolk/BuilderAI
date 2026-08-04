export type HtmlStructuredAnalysisParseStatus = 'SUCCESS' | 'FALLBACK';

export type HtmlStructuredAnalysisFallbackReason =
  | 'BASELINE_TOO_LARGE'
  | 'PROPOSED_TOO_LARGE'
  | 'PARSE_ERROR'
  | 'TIME_LIMIT'
  | 'NODE_LIMIT'
  | 'DEPTH_LIMIT';

export interface HtmlStructuredAnalysis {
  readonly kind: 'HTML';
  readonly parseStatus: HtmlStructuredAnalysisParseStatus;
  readonly attributeChanges: number;
  readonly textChanges: number;
  readonly structuralChanges: number;
  readonly formattingOnlyEvidence: boolean;
  readonly preservedStableIdCount: number;
  readonly removedStableIdCount: number;
  readonly elementCountBaseline: number;
  readonly elementCountProposed: number;
  readonly fallbackReason?: HtmlStructuredAnalysisFallbackReason;
}

export interface StructuredHtmlAnalysisConfiguration {
  readonly maximumBaselineBytes: number;
  readonly parseTimeLimitMs: number;
  readonly maximumDomNodes: number;
  readonly maximumTreeDepth: number;
}

export interface HtmlStructuredDeltaInput {
  readonly baselineContent: string;
  readonly proposedContent: string;
  readonly churnRatio: number;
  readonly elevatedChurnThreshold: number;
  readonly configuration: StructuredHtmlAnalysisConfiguration;
}
