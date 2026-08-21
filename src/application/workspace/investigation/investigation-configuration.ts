export interface InvestigationConfiguration {
  readonly maximumSearchQueries: number;
  /**
   * Maximum number of files whose content is read during search. Files are selected by
   * path-relevance scoring from the full eligible inventory, not lexicographic truncation.
   */
  readonly maximumFilesScanned: number;
  /**
   * Maximum number of eligible paths scored during candidate selection. Bounds the cost of
   * path-level scoring for very large repositories. All eligible paths up to this limit are
   * scored; only the top `maximumFilesScanned` by path relevance have their content read.
   */
  readonly maximumCandidatePaths: number;
  readonly maximumMatches: number;
  readonly maximumMatchesPerFile: number;
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
  maximumCandidatePaths: 15_000,
  maximumMatches: 48,
  maximumMatchesPerFile: 3,
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
