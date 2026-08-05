export interface Gate2ReviewConfiguration {
  readonly maximumLinesPerOperation: number;
  readonly maximumCharactersPerOperation: number;
  readonly maximumTotalCharacters: number;
  readonly contextLines: number;
}

export const DEFAULT_GATE2_REVIEW_CONFIGURATION: Gate2ReviewConfiguration = {
  maximumLinesPerOperation: 500,
  maximumCharactersPerOperation: 32_000,
  maximumTotalCharacters: 128_000,
  contextLines: 3,
};

export const GATE2_DIFF_TRUNCATION_MESSAGE =
  'Diff truncated for review. Inspect the file externally before approval.';

export const GATE2_TOTAL_TRUNCATION_MESSAGE =
  'Total Gate 2 diff payload truncated for review. Inspect affected files externally before approval.';

export const GATE2_TEXT_DIFF_UNAVAILABLE_MESSAGE = 'Text diff unavailable for this operation.';

export const GATE2_PROTECTED_DIFF_MESSAGE =
  'Diff unavailable for protected paths. Protected content is never exposed through Gate 2 review.';
