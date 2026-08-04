import type { ArtifactChecksum } from '../../core/response-processor';
import type {
  PreservationFindingSeverity,
  UpdatePreservationAssessment,
  UpdatePreservationFinding,
} from '../../core/change-planner';
import type { ProjectChangeWarning } from '../../core/change-planner';

export function formatPreservationPercentage(ratio: number | undefined): string | undefined {
  if (ratio === undefined || !Number.isFinite(ratio)) return undefined;
  return `${(ratio * 100).toFixed(2)}%`;
}

export function abbreviateChecksum(checksum: ArtifactChecksum | undefined): string | undefined {
  if (checksum === undefined) return undefined;
  const value = checksum.value;
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

export function formatPreservationFindingCode(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function preservationSeverityLabel(severity: PreservationFindingSeverity): string {
  return severity;
}

export function hasBaselineUnavailableWarning(
  warnings: readonly ProjectChangeWarning[],
  operationId: string,
): ProjectChangeWarning | undefined {
  return warnings.find(
    (warning) =>
      warning.code === 'PRESERVATION_BASELINE_UNAVAILABLE' &&
      warning.operationIds.includes(operationId),
  );
}

export function listPreservationMetricItems(
  preservation: UpdatePreservationAssessment,
  baselineContentChecksum: ArtifactChecksum | undefined,
  proposedContentChecksum: ArtifactChecksum,
): readonly (readonly [string, string])[] {
  const churn = formatPreservationPercentage(preservation.churnRatio);
  const similarity = formatPreservationPercentage(preservation.similarityRatio);
  const baselineChecksum = abbreviateChecksum(
    baselineContentChecksum ?? preservation.baselineContentChecksum,
  );
  const proposedChecksum = abbreviateChecksum(proposedContentChecksum);
  const items: (readonly [string, string])[] = [];
  if (churn !== undefined) items.push(['Churn', churn]);
  if (similarity !== undefined) items.push(['Similarity', similarity]);
  if (preservation.linesAdded !== undefined) {
    items.push(['Lines added', String(preservation.linesAdded)]);
  }
  if (preservation.linesDeleted !== undefined) {
    items.push(['Lines deleted', String(preservation.linesDeleted)]);
  }
  if (preservation.linesUnchanged !== undefined) {
    items.push(['Lines unchanged', String(preservation.linesUnchanged)]);
  }
  if (baselineChecksum !== undefined) items.push(['Baseline checksum', baselineChecksum]);
  if (proposedChecksum !== undefined) items.push(['Proposed checksum', proposedChecksum]);
  return items;
}

export function isHighVisibilityFinding(finding: UpdatePreservationFinding): boolean {
  return finding.severity === 'HIGH' || finding.severity === 'CRITICAL';
}

export function joinBoundedList(values: readonly string[] | undefined): string | undefined {
  if (values === undefined || values.length === 0) return undefined;
  return values.join(', ');
}
