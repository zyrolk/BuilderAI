import type { ArtifactChecksum } from '../../response-processor';

export interface WorkspaceBaselineSnapshot {
  readonly logicalPath: string;
  readonly content: string;
  readonly checksum: ArtifactChecksum;
  readonly sizeBytes: number;
}

/**
 * Read-only, synchronous baseline content access for planning-time comparison. Separate from
 * {@link WorkspaceVisibilityPort}, which exposes existence booleans only (ADR-016).
 */
export interface WorkspaceBaselinePort {
  /**
   * Reads the current regular-file contents for planning-time comparison.
   * Returns null when the target is missing, not a regular file, is a symlink,
   * exceeds size limits, appears binary, or cannot be read deterministically.
   */
  readTextBaseline(logicalPath: string): WorkspaceBaselineSnapshot | null;
}
