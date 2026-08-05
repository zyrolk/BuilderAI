export const TARGET_PROJECT_MANIFEST_SCHEMA_VERSION = 1 as const;

export interface TargetProjectFolderOwnership {
  readonly path: string;
  readonly owner: string;
  readonly responsibility: string;
}

export interface TargetProjectConstraint {
  readonly id: string;
  readonly statement: string;
  readonly rationale: string;
}

export interface TargetProjectManifest {
  readonly schemaVersion: typeof TARGET_PROJECT_MANIFEST_SCHEMA_VERSION;
  readonly projectId: string;
  readonly name: string;
  readonly vision: string;
  readonly currentMilestone: string;
  readonly constraints?: readonly TargetProjectConstraint[];
  readonly protectedAreas?: readonly string[];
  readonly folderOwnership?: readonly TargetProjectFolderOwnership[];
  readonly sourceRoots?: readonly string[];
  readonly staticSourceRoots?: readonly string[];
}
