export const REPOSITORY_BASELINE_SCHEMA_VERSION = 1 as const;

export interface RepositoryBaselineFileEntry {
  readonly logicalPath: string;
  readonly checksum: string;
  readonly sizeBytes: number;
}

export interface RepositoryBaseline {
  readonly schemaVersion: typeof REPOSITORY_BASELINE_SCHEMA_VERSION;
  readonly repositoryRoot: string;
  readonly gitAvailable: boolean;
  readonly branch?: string;
  readonly headCommit?: string;
  readonly workingTreeState?: string;
  readonly untrackedFileCount: number;
  readonly fileEntries: readonly RepositoryBaselineFileEntry[];
  readonly capturedAt: string;
  readonly baselineDigest: string;
}
