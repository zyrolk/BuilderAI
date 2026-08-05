import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { ProjectSourceIndexOptions } from '../../infrastructure/project/project-source-index-policy';
import { TARGET_PROJECT_MANIFEST_PATH } from './external-target-documents';
import { parseTargetProjectManifest } from './target-project-manifest.validator';
import type { WorkspaceProjectProfile } from './workspace-project-profile.types';

export function loadExternalTargetSourceIndexOptions(
  projectRoot: string,
  profile: WorkspaceProjectProfile,
): ProjectSourceIndexOptions {
  if (profile !== 'EXTERNAL_TARGET') return {};
  const manifestPath = path.join(projectRoot, TARGET_PROJECT_MANIFEST_PATH);
  if (!existsSync(manifestPath)) return {};
  try {
    const manifest = parseTargetProjectManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
    );
    return {
      ...(manifest.sourceRoots === undefined ? {} : { manifestScanRoots: manifest.sourceRoots }),
      ...(manifest.staticSourceRoots === undefined
        ? {}
        : { staticScanRoots: manifest.staticSourceRoots }),
    };
  } catch {
    return {};
  }
}
