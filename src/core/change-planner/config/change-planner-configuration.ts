import type { StructuredHtmlAnalysisConfiguration } from '../types/html-structured-analysis';

export interface PreservationConfiguration {
  readonly elevatedChurnThreshold: number;
  readonly highChurnThreshold: number;
  readonly maximumCrossFileChecks: number;
  readonly maximumListedHtmlIds: number;
  readonly structuredHtml: StructuredHtmlAnalysisConfiguration;
}

export const DEFAULT_STRUCTURED_HTML_ANALYSIS_CONFIGURATION: StructuredHtmlAnalysisConfiguration = {
  maximumBaselineBytes: 524_288,
  parseTimeLimitMs: 250,
  maximumDomNodes: 10_000,
  maximumTreeDepth: 128,
};

export interface ChangePlannerConfiguration {
  readonly maximumOperations: number;
  readonly maximumMetadataEntries: number;
  readonly maximumMetadataStringCharacters: number;
  readonly broadChangeOperationThreshold: number;
  readonly preservation: PreservationConfiguration;
}

export const DEFAULT_PRESERVATION_CONFIGURATION: PreservationConfiguration = {
  elevatedChurnThreshold: 0.4,
  highChurnThreshold: 0.7,
  maximumCrossFileChecks: 2,
  maximumListedHtmlIds: 8,
  structuredHtml: DEFAULT_STRUCTURED_HTML_ANALYSIS_CONFIGURATION,
};

export const DEFAULT_CHANGE_PLANNER_CONFIGURATION: ChangePlannerConfiguration = {
  maximumOperations: 100,
  maximumMetadataEntries: 32,
  maximumMetadataStringCharacters: 2_000,
  broadChangeOperationThreshold: 20,
  preservation: DEFAULT_PRESERVATION_CONFIGURATION,
};
