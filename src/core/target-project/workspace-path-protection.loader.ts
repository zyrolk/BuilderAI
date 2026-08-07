import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { TARGET_PROJECT_MANIFEST_PATH } from './external-target-documents';
import { parseTargetProjectManifest } from './target-project-manifest.validator';
import type { WorkspaceProjectProfile } from './workspace-project-profile.types';
import {
  createWorkspacePathProtectionPolicyFromManifest,
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from './workspace-path-protection';

export function loadWorkspacePathProtectionPolicy(
  projectRoot: string,
  profile: WorkspaceProjectProfile,
): WorkspacePathProtectionPolicy {
  if (profile !== 'EXTERNAL_TARGET') return DEFAULT_WORKSPACE_PATH_PROTECTION;
  const manifestPath = path.join(projectRoot, TARGET_PROJECT_MANIFEST_PATH);
  if (!existsSync(manifestPath)) return DEFAULT_WORKSPACE_PATH_PROTECTION;
  try {
    const manifest = parseTargetProjectManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
    );
    return createWorkspacePathProtectionPolicyFromManifest(manifest.protectedAreas);
  } catch {
    return DEFAULT_WORKSPACE_PATH_PROTECTION;
  }
}
