export type SurgicalityClassification = 'EXCELLENT' | 'GOOD' | 'MARGINAL' | 'POOR' | 'UNAVAILABLE';

export type SurgicalityBasis = 'STRUCTURED_HTML' | 'GENERIC_LINE_LCS' | 'UNAVAILABLE';

export interface SurgicalityAssessment {
  readonly classification: SurgicalityClassification;
  readonly basis: SurgicalityBasis;
  readonly reasons: readonly string[];
}
