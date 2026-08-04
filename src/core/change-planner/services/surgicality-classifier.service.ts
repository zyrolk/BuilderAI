import type { PreservationConfiguration } from '../config';
import type { HtmlStructuredAnalysis } from '../types/html-structured-analysis';
import type {
  SurgicalityAssessment,
  SurgicalityBasis,
  SurgicalityClassification,
} from '../types/surgicality-assessment';
import type { CrossFileReferenceRisk } from '../types/update-preservation';

export interface SurgicalityClassifierInput {
  readonly logicalPath: string;
  readonly churnRatio: number;
  readonly structuredAnalysis?: HtmlStructuredAnalysis;
  readonly removedHtmlIds: readonly string[];
  readonly removedAccessibilityAttributes: readonly string[];
  readonly crossFileReferenceRisks: readonly CrossFileReferenceRisk[];
  readonly largeDeletionSuspicious: boolean;
  readonly preservationConfiguration: PreservationConfiguration;
}

const MAX_GOOD_TEXT_CHANGES = 2;

function formatRatio(ratio: number): string {
  return (Math.round(ratio * 10_000) / 100).toFixed(2);
}

function buildAssessment(
  classification: SurgicalityClassification,
  basis: SurgicalityBasis,
  reasons: readonly string[],
): SurgicalityAssessment {
  return {
    classification,
    basis,
    reasons: [...reasons].sort((left, right) => left.localeCompare(right)),
  };
}

function layer1FailureReasons(input: SurgicalityClassifierInput): readonly string[] {
  const reasons: string[] = [];
  if (input.removedHtmlIds.length > 0) {
    reasons.push('Layer 1: removed stable HTML ids');
  }
  if (input.removedAccessibilityAttributes.length > 0) {
    reasons.push('Layer 1: removed accessibility attributes');
  }
  if (input.crossFileReferenceRisks.length > 0) {
    reasons.push('Layer 1: cross-file reference risk');
  }
  if (input.largeDeletionSuspicious) {
    reasons.push('Layer 1: suspicious large deletion');
  }
  return reasons;
}

function hasLayer1Failure(input: SurgicalityClassifierInput): boolean {
  return layer1FailureReasons(input).length > 0;
}

function classifyStructuredHtml(
  input: SurgicalityClassifierInput,
  structured: HtmlStructuredAnalysis,
): SurgicalityAssessment {
  const layer1Reasons = layer1FailureReasons(input);
  if (layer1Reasons.length > 0) {
    return buildAssessment('POOR', 'STRUCTURED_HTML', layer1Reasons);
  }

  const { attributeChanges, textChanges, structuralChanges, formattingOnlyEvidence } = structured;
  const { churnRatio, preservationConfiguration } = input;

  if (
    structuralChanges > 0 ||
    textChanges > MAX_GOOD_TEXT_CHANGES ||
    churnRatio >= preservationConfiguration.highChurnThreshold
  ) {
    const reasons: string[] = [];
    if (structuralChanges > 0)
      reasons.push(`Structured HTML: ${structuralChanges} structural change(s)`);
    if (textChanges > MAX_GOOD_TEXT_CHANGES) {
      reasons.push(`Structured HTML: ${textChanges} text change(s)`);
    }
    if (churnRatio >= preservationConfiguration.highChurnThreshold) {
      reasons.push(`Line churn ${formatRatio(churnRatio)}% (high rewrite evidence)`);
    }
    return buildAssessment('POOR', 'STRUCTURED_HTML', reasons);
  }

  if (
    structuralChanges === 0 &&
    textChanges === 0 &&
    attributeChanges > 0 &&
    !formattingOnlyEvidence
  ) {
    return buildAssessment('EXCELLENT', 'STRUCTURED_HTML', [
      `Structured HTML: ${attributeChanges} attribute-only change(s)`,
    ]);
  }

  if (
    formattingOnlyEvidence ||
    (churnRatio >= preservationConfiguration.elevatedChurnThreshold &&
      structuralChanges === 0 &&
      textChanges === 0 &&
      attributeChanges === 0)
  ) {
    const reasons: string[] = [];
    if (formattingOnlyEvidence) reasons.push('Structured HTML: formatting-only evidence');
    if (churnRatio >= preservationConfiguration.elevatedChurnThreshold) {
      reasons.push(`Line churn ${formatRatio(churnRatio)}% (elevated; no structured delta)`);
    }
    return buildAssessment('MARGINAL', 'STRUCTURED_HTML', reasons);
  }

  if (structuralChanges === 0 && textChanges <= MAX_GOOD_TEXT_CHANGES) {
    const reasons: string[] = [];
    if (attributeChanges > 0)
      reasons.push(`Structured HTML: ${attributeChanges} attribute change(s)`);
    if (textChanges > 0) reasons.push(`Structured HTML: ${textChanges} text change(s)`);
    if (reasons.length === 0) reasons.push('Structured HTML: limited non-destructive delta');
    return buildAssessment('GOOD', 'STRUCTURED_HTML', reasons);
  }

  return buildAssessment('MARGINAL', 'STRUCTURED_HTML', [
    'Structured HTML: non-destructive but elevated churn',
  ]);
}

function classifyGenericLineLcs(input: SurgicalityClassifierInput): SurgicalityAssessment {
  const layer1Reasons = layer1FailureReasons(input);
  if (layer1Reasons.length > 0) {
    return buildAssessment('POOR', 'GENERIC_LINE_LCS', layer1Reasons);
  }

  const { churnRatio, preservationConfiguration } = input;
  if (churnRatio >= preservationConfiguration.highChurnThreshold) {
    return buildAssessment('POOR', 'GENERIC_LINE_LCS', [
      `Line churn ${formatRatio(churnRatio)}% (high)`,
    ]);
  }
  if (churnRatio >= preservationConfiguration.elevatedChurnThreshold) {
    return buildAssessment('MARGINAL', 'GENERIC_LINE_LCS', [
      `Line churn ${formatRatio(churnRatio)}% (elevated)`,
    ]);
  }
  if (churnRatio < preservationConfiguration.elevatedChurnThreshold / 2) {
    return buildAssessment('EXCELLENT', 'GENERIC_LINE_LCS', [
      `Line churn ${formatRatio(churnRatio)}%`,
    ]);
  }
  return buildAssessment('GOOD', 'GENERIC_LINE_LCS', [`Line churn ${formatRatio(churnRatio)}%`]);
}

export class SurgicalityClassifierService {
  classify(input: SurgicalityClassifierInput): SurgicalityAssessment {
    const structured = input.structuredAnalysis;
    if (
      structured !== undefined &&
      structured.kind === 'HTML' &&
      structured.parseStatus === 'SUCCESS'
    ) {
      return classifyStructuredHtml(input, structured);
    }

    if (input.churnRatio === undefined || !Number.isFinite(input.churnRatio)) {
      return buildAssessment('UNAVAILABLE', 'UNAVAILABLE', ['Preservation metrics unavailable']);
    }

    return classifyGenericLineLcs(input);
  }

  classifyUnavailable(): SurgicalityAssessment {
    return buildAssessment('UNAVAILABLE', 'UNAVAILABLE', ['Preservation analysis unavailable']);
  }
}

export function hasLayer1PreservationFailure(input: SurgicalityClassifierInput): boolean {
  return hasLayer1Failure(input);
}
