import type { IterationPreservationRejection } from '../../../application/workspace/iteration-feedback.types';
import { ITERATION_FEEDBACK_LIMITS } from '../../../application/workspace/iteration-feedback.types';
import {
  isElevatedChurnRatio,
  isHighChurnRatio,
} from '../../../application/workspace/preservation-rejection-builder.service';
import { DEFAULT_PRESERVATION_CONFIGURATION } from '../../change-planner/config';

/** Slice 4 generic surgicality guidance — not an engine acceptance threshold. */
const SURGICALITY_EXCELLENT_CHURN_PREFERRED_TARGET = 0.2;

export function renderPreservationRejectionText(rejection: IterationPreservationRejection): string {
  const lines: string[] = ['PREVIOUS PROPOSAL REJECTED FOR PRESERVATION VIOLATIONS'];

  for (const operation of rejection.operations) {
    lines.push(formatOperationLine(operation));
  }

  if (rejection.unrequestedPaths !== undefined && rejection.unrequestedPaths.length > 0) {
    lines.push(`Unrequested paths: ${rejection.unrequestedPaths.join(', ')}`);
  }

  if (rejection.operatorReason !== undefined) {
    lines.push(`Operator reason: ${rejection.operatorReason}`);
  }

  lines.push(
    'Preserve the supplied CURRENT BASELINE. Make only the minimum requested changes. Do not redesign, restructure, or rename stable identifiers.',
  );

  lines.push(...renderCorrectionGuidance(rejection));

  return truncateDeterministic(
    lines.join('\n'),
    ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_REJECTION_RENDERED_CHARACTERS,
  );
}

function renderCorrectionGuidance(rejection: IterationPreservationRejection): readonly string[] {
  const structuredOperations = rejection.operations.filter(
    (operation) => operation.surgicalityBasis === 'STRUCTURED_HTML',
  );
  if (structuredOperations.length > 0) {
    return renderStructuredHtmlCorrectionGuidance(rejection, structuredOperations);
  }

  return renderGenericChurnCorrectionGuidance(rejection);
}

function renderStructuredHtmlCorrectionGuidance(
  rejection: IterationPreservationRejection,
  structuredOperations: IterationPreservationRejection['operations'],
): readonly string[] {
  const churnRatios = rejection.operations
    .map(({ churnRatio }) => churnRatio)
    .filter((churnRatio): churnRatio is number => churnRatio !== undefined);
  const peakChurnRatio = churnRatios.length === 0 ? undefined : Math.max(...churnRatios);
  const peakPercent = peakChurnRatio === undefined ? undefined : formatChurnPercent(peakChurnRatio);

  const lines = [
    'Structured HTML surgicality is authoritative. Preserve ids, text, and structure; prefer attribute-only or minimal deltas.',
  ];

  if (peakPercent !== undefined) {
    lines.push(
      `Line churn ${peakPercent}% is diagnostic only; elevated line churn may remain for multi-line attribute edits.`,
    );
  }

  const attributeSummary = structuredOperations
    .map((operation) => {
      const attributes = operation.structuredAttributeChanges;
      const textChanges = operation.structuredTextChanges;
      const structuralChanges = operation.structuredStructuralChanges;
      if (
        attributes === undefined &&
        textChanges === undefined &&
        structuralChanges === undefined
      ) {
        return undefined;
      }
      return `${operation.logicalPath}: attributes ${attributes ?? 0}, text ${textChanges ?? 0}, structure ${structuralChanges ?? 0}`;
    })
    .filter((line): line is string => line !== undefined);

  if (attributeSummary.length > 0) {
    lines.push(`Structured delta: ${attributeSummary.join('; ')}.`);
  }

  return lines;
}

function renderGenericChurnCorrectionGuidance(
  rejection: IterationPreservationRejection,
): readonly string[] {
  const churnRatios = rejection.operations
    .map(({ churnRatio }) => churnRatio)
    .filter((churnRatio): churnRatio is number => churnRatio !== undefined);
  if (churnRatios.length === 0) return [];

  const peakChurnRatio = Math.max(...churnRatios);
  if (
    peakChurnRatio < DEFAULT_PRESERVATION_CONFIGURATION.elevatedChurnThreshold &&
    !churnRatios.some((churnRatio) => isHighChurnRatio(churnRatio))
  ) {
    return [];
  }

  const previousPercent = formatChurnPercent(peakChurnRatio);
  const goodPercent = formatChurnPercent(DEFAULT_PRESERVATION_CONFIGURATION.elevatedChurnThreshold);
  const excellentPercent = formatChurnPercent(SURGICALITY_EXCELLENT_CHURN_PREFERRED_TARGET);

  return [
    `Churn correction: previous ${previousPercent}%; target <${goodPercent}% (GOOD); prefer <${excellentPercent}% (EXCELLENT; guidance only). Keep unchanged baseline lines verbatim; minimize textual delta.`,
  ];
}

function formatChurnPercent(churnRatio: number): string {
  return (Math.round(churnRatio * 10_000) / 100).toFixed(2);
}

function formatOperationLine(
  operation: IterationPreservationRejection['operations'][number],
): string {
  const parts: string[] = [`- ${operation.logicalPath}`];

  if (operation.churnRatio !== undefined) {
    const percent = Math.round(operation.churnRatio * 100);
    if (isHighChurnRatio(operation.churnRatio)) {
      parts.push(`had ${percent}% churn (HIGH)`);
    } else if (isElevatedChurnRatio(operation.churnRatio)) {
      parts.push(`had ${percent}% churn (ELEVATED)`);
    } else {
      parts.push(`had ${percent}% churn`);
    }
  }

  if (operation.surgicalityClassification !== undefined) {
    parts.push(`surgicality ${operation.surgicalityClassification}`);
  }

  if (operation.removedHtmlIds !== undefined && operation.removedHtmlIds.length > 0) {
    parts.push(`removed stable IDs: ${operation.removedHtmlIds.join(', ')}`);
  }

  if (
    operation.removedAccessibilityAttributes !== undefined &&
    operation.removedAccessibilityAttributes.length > 0
  ) {
    parts.push(
      `removed accessibility attributes: ${operation.removedAccessibilityAttributes.join(', ')}`,
    );
  }

  if (
    operation.crossFileReferenceRisks !== undefined &&
    operation.crossFileReferenceRisks.length > 0
  ) {
    const references = operation.crossFileReferenceRisks.map((risk) => {
      const separator = risk.indexOf('@');
      if (separator <= 0) return risk;
      const referencingPath = risk.slice(separator + 1);
      const removedId = risk.slice(0, separator);
      return `${referencingPath} references ${removedId}`;
    });
    parts.push(`cross-file risks: ${references.join('; ')}`);
  }

  if (operation.findingCodes.length > 0) {
    parts.push(`findings: ${operation.findingCodes.join(', ')}`);
  }

  return parts.join('; ');
}

function truncateDeterministic(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const marker = '…';
  return text.slice(0, Math.max(0, maxLength - marker.length)) + marker;
}
