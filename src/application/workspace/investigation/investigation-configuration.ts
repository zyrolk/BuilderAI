export interface InvestigationConfiguration {
  readonly maximumSearchQueries: number;
  readonly maximumFilesScanned: number;
  readonly maximumMatches: number;
  readonly maximumExcerptCharacters: number;
  readonly maximumEvidenceFiles: number;
  readonly maximumTotalContextCharacters: number;
  readonly maximumHypotheses: number;
  readonly maximumRecommendedSteps: number;
  readonly contextLinesAroundMatch: number;
}

export const DEFAULT_INVESTIGATION_CONFIGURATION: InvestigationConfiguration = {
  maximumSearchQueries: 12,
  maximumFilesScanned: 400,
  maximumMatches: 48,
  maximumExcerptCharacters: 240,
  maximumEvidenceFiles: 16,
  maximumTotalContextCharacters: 64_000,
  maximumHypotheses: 6,
  maximumRecommendedSteps: 8,
  contextLinesAroundMatch: 2,
};

export const INVESTIGATION_BOUNDED_MESSAGE =
  'Investigation was bounded by configured limits. Results may not reflect the full repository.';

export const INVESTIGATION_PROTECTED_SKIPPED_MESSAGE =
  'Protected paths were excluded from repository search and evidence excerpts.';
