import {
  DEFAULT_PRESERVATION_CONFIGURATION,
  type ProjectChangePlan,
  type UpdateFileOperation,
} from '../../core/change-planner';
import type { PreservationFindingCode } from '../../core/change-planner/types/update-preservation';
import {
  ITERATION_FEEDBACK_LIMITS,
  type IterationPreservationRejection,
  type IterationPreservationRejectionOperation,
} from './iteration-feedback.types';

const PRESERVATION_FINDING_CODES = new Set<string>([
  'PRESERVATION_BASELINE_UNAVAILABLE',
  'PRESERVATION_HIGH_CHURN_REWRITE',
  'PRESERVATION_ELEVATED_CHURN',
  'PRESERVATION_REMOVED_HTML_ID',
  'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
  'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
  'PRESERVATION_LARGE_DELETION',
]);

const UPDATE_SCOPE_PREFERRED_PATHS_KEY = 'update-scope-preferred-paths';
const UPDATE_SCOPE_PATH_SEPARATOR = '\u001f';

export interface PreservationRejectionBuildOptions {
  readonly rejectedPreparationId?: string;
  readonly operatorReason?: string;
}

export function buildPreservationRejectionFromChangePlan(
  changePlan: ProjectChangePlan,
  options: PreservationRejectionBuildOptions = {},
): IterationPreservationRejection | undefined {
  const operations = buildPreservationRejectionOperations(changePlan);
  const unrequestedPaths = extractUnrequestedPaths(changePlan);
  if (
    operations.length === 0 &&
    unrequestedPaths.length === 0 &&
    options.operatorReason === undefined
  ) {
    return undefined;
  }

  return {
    ...(normalizeOptionalPreparationId(options.rejectedPreparationId) === undefined
      ? {}
      : { rejectedPreparationId: normalizeOptionalPreparationId(options.rejectedPreparationId) }),
    ...(normalizeOperatorReason(options.operatorReason) === undefined
      ? {}
      : { operatorReason: normalizeOperatorReason(options.operatorReason) }),
    operations,
    ...(unrequestedPaths.length === 0 ? {} : { unrequestedPaths }),
  };
}

function buildPreservationRejectionOperations(
  changePlan: ProjectChangePlan,
): readonly IterationPreservationRejectionOperation[] {
  const updateOperations = changePlan.changeSet.operations
    .filter((operation): operation is UpdateFileOperation => operation.kind === 'UPDATE_FILE')
    .sort((left, right) => left.logicalPath.localeCompare(right.logicalPath))
    .slice(0, ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_OPERATIONS);

  const built: IterationPreservationRejectionOperation[] = [];
  for (const operation of updateOperations) {
    const builtOperation = buildPreservationRejectionOperation(operation);
    if (builtOperation !== undefined) built.push(builtOperation);
  }
  return built;
}

function buildPreservationRejectionOperation(
  operation: UpdateFileOperation,
): IterationPreservationRejectionOperation | undefined {
  const preservation = operation.preservation;
  if (preservation === undefined) return undefined;

  const findingCodes = dedupeSorted(
    preservation.findings
      .map(({ code }) => code)
      .filter((code): code is PreservationFindingCode => PRESERVATION_FINDING_CODES.has(code)),
  ).slice(0, ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_FINDING_CODES);

  const removedHtmlIds =
    preservation.removedHtmlIds === undefined
      ? undefined
      : dedupeSorted(preservation.removedHtmlIds).slice(
          0,
          ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_REMOVED_IDS,
        );

  const removedAccessibilityAttributes =
    preservation.removedAccessibilityAttributes === undefined
      ? undefined
      : dedupeSorted(preservation.removedAccessibilityAttributes).slice(
          0,
          ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_REMOVED_ARIA,
        );

  const crossFileReferenceRisks =
    preservation.crossFileReferenceRisks === undefined
      ? undefined
      : dedupeSorted(
          preservation.crossFileReferenceRisks.map(
            ({ removedId, referencingLogicalPath }) => `${removedId}@${referencingLogicalPath}`,
          ),
        ).slice(0, ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_CROSS_FILE_RISKS);

  if (
    findingCodes.length === 0 &&
    (removedHtmlIds === undefined || removedHtmlIds.length === 0) &&
    (removedAccessibilityAttributes === undefined || removedAccessibilityAttributes.length === 0) &&
    (crossFileReferenceRisks === undefined || crossFileReferenceRisks.length === 0) &&
    preservation.churnRatio === undefined &&
    preservation.similarityRatio === undefined
  ) {
    return undefined;
  }

  return {
    logicalPath: operation.logicalPath,
    ...(preservation.churnRatio === undefined ? {} : { churnRatio: preservation.churnRatio }),
    ...(preservation.similarityRatio === undefined
      ? {}
      : { similarityRatio: preservation.similarityRatio }),
    findingCodes,
    ...(removedHtmlIds === undefined || removedHtmlIds.length === 0 ? {} : { removedHtmlIds }),
    ...(removedAccessibilityAttributes === undefined || removedAccessibilityAttributes.length === 0
      ? {}
      : { removedAccessibilityAttributes }),
    ...(crossFileReferenceRisks === undefined || crossFileReferenceRisks.length === 0
      ? {}
      : { crossFileReferenceRisks }),
    ...(preservation.surgicality === undefined
      ? {}
      : {
          surgicalityClassification: preservation.surgicality.classification,
          surgicalityBasis: preservation.surgicality.basis,
        }),
    ...(preservation.structuredAnalysis !== undefined &&
    preservation.structuredAnalysis.parseStatus === 'SUCCESS'
      ? {
          structuredAttributeChanges: preservation.structuredAnalysis.attributeChanges,
          structuredTextChanges: preservation.structuredAnalysis.textChanges,
          structuredStructuralChanges: preservation.structuredAnalysis.structuralChanges,
        }
      : {}),
  };
}

function extractUnrequestedPaths(changePlan: ProjectChangePlan): readonly string[] {
  const preferredPaths = readPreferredUpdatePaths(changePlan.metadata);
  if (preferredPaths.length === 0) {
    return extractUnrequestedPathsFromWarnings(changePlan);
  }

  const preferred = new Set(preferredPaths);
  const unrequested = changePlan.changeSet.operations
    .map(({ logicalPath }) => logicalPath)
    .filter((path) => !preferred.has(path));
  return dedupeSorted(unrequested).slice(
    0,
    ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_UNREQUESTED_PATHS,
  );
}

function extractUnrequestedPathsFromWarnings(changePlan: ProjectChangePlan): readonly string[] {
  const operationPaths = new Map(
    changePlan.changeSet.operations.map((operation) => [
      operation.operationId,
      operation.logicalPath,
    ]),
  );
  const paths: string[] = [];
  for (const warning of changePlan.warnings) {
    if (warning.code !== 'SCOPE_DEVIATION') continue;
    for (const operationId of warning.operationIds) {
      const path = operationPaths.get(operationId);
      if (path !== undefined) paths.push(path);
    }
  }
  return dedupeSorted(paths).slice(0, ITERATION_FEEDBACK_LIMITS.MAX_PRESERVATION_UNREQUESTED_PATHS);
}

function readPreferredUpdatePaths(metadata: ProjectChangePlan['metadata']): readonly string[] {
  const raw = metadata[UPDATE_SCOPE_PREFERRED_PATHS_KEY];
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return dedupeSorted(raw.split(UPDATE_SCOPE_PATH_SEPARATOR).map((path) => path.trim()));
}

export function isHighChurnRatio(churnRatio: number | undefined): boolean {
  return (
    churnRatio !== undefined && churnRatio >= DEFAULT_PRESERVATION_CONFIGURATION.highChurnThreshold
  );
}

export function isElevatedChurnRatio(churnRatio: number | undefined): boolean {
  return (
    churnRatio !== undefined &&
    churnRatio >= DEFAULT_PRESERVATION_CONFIGURATION.elevatedChurnThreshold &&
    churnRatio < DEFAULT_PRESERVATION_CONFIGURATION.highChurnThreshold
  );
}

function dedupeSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

const PREPARATION_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/u;

function normalizeOptionalPreparationId(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return PREPARATION_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function normalizeOperatorReason(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const sanitized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (sanitized.length === 0) return undefined;
  return sanitized.length <= ITERATION_FEEDBACK_LIMITS.MAX_OPERATOR_REASON
    ? sanitized
    : sanitized.slice(0, ITERATION_FEEDBACK_LIMITS.MAX_OPERATOR_REASON);
}
