import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseProjectBrain, type ProjectBrain } from '../project-brain';
import { TARGET_PROJECT_MANIFEST_PATH } from './external-target-documents';
import {
  ExternalTargetOnboardingError,
  formatExternalTargetOnboardingMessage,
} from './external-target-project-reader.service';
import { createSyntheticProjectBrain } from './synthetic-project-brain.service';
import {
  parseTargetProjectManifest,
  TargetProjectManifestValidationError,
} from './target-project-manifest.validator';
import type { WorkspaceProjectProfile } from './workspace-project-profile.types';

export function loadWorkspaceProjectBrain(
  projectRoot: string,
  profile: WorkspaceProjectProfile,
  clock: () => string = () => new Date().toISOString(),
): ProjectBrain {
  if (profile === 'BUILDERAI_SELF') {
    return parseProjectBrain(
      JSON.parse(readFileSync(path.join(projectRoot, 'project-brain.json'), 'utf8')) as unknown,
    );
  }

  const brainPath = path.join(projectRoot, 'project-brain.json');
  if (existsSync(brainPath)) {
    return parseProjectBrain(JSON.parse(readFileSync(brainPath, 'utf8')) as unknown);
  }

  const manifestPath = path.join(projectRoot, TARGET_PROJECT_MANIFEST_PATH);
  if (!existsSync(manifestPath)) {
    throw new ExternalTargetOnboardingError(
      [
        {
          path: TARGET_PROJECT_MANIFEST_PATH,
          message:
            'Create .builderai/target-project.json from templates/external-target-bootstrap/target-project.json.',
        },
      ],
      [TARGET_PROJECT_MANIFEST_PATH],
    );
  }

  try {
    const manifest = parseTargetProjectManifest(
      JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
    );
    return createSyntheticProjectBrain(manifest, clock());
  } catch (error: unknown) {
    if (error instanceof TargetProjectManifestValidationError) {
      throw new ExternalTargetOnboardingError(
        error.issues.map(({ path: issuePath, message }) => ({ path: issuePath, message })),
        [TARGET_PROJECT_MANIFEST_PATH],
      );
    }
    throw new ExternalTargetOnboardingError(
      [
        {
          path: TARGET_PROJECT_MANIFEST_PATH,
          message: error instanceof Error ? error.message : 'Target project manifest is invalid.',
        },
      ],
      [TARGET_PROJECT_MANIFEST_PATH],
    );
  }
}

export function readWorkspaceProjectId(
  projectRoot: string,
  profile: WorkspaceProjectProfile,
): string {
  if (profile === 'BUILDERAI_SELF') {
    return readProjectIdFromBrainFile(projectRoot) ?? 'builder-ai';
  }

  try {
    return loadWorkspaceProjectBrain(projectRoot, profile).blueprint.projectId;
  } catch (error: unknown) {
    if (error instanceof ExternalTargetOnboardingError) {
      throw new WorkspaceProjectIdUnavailableError(error);
    }
    throw error;
  }
}

function readProjectIdFromBrainFile(projectRoot: string): string | undefined {
  try {
    const brain = JSON.parse(
      readFileSync(path.join(projectRoot, 'project-brain.json'), 'utf8'),
    ) as { readonly blueprint?: { readonly projectId?: string } };
    const projectId = brain.blueprint?.projectId?.trim();
    if (projectId !== undefined && projectId.length > 0) return projectId;
  } catch {
    // fall through
  }
  return undefined;
}

export class WorkspaceProjectIdUnavailableError extends Error {
  constructor(readonly onboarding: ExternalTargetOnboardingError) {
    super(formatExternalTargetOnboardingMessage(onboarding.issues, onboarding.missingPaths));
    this.name = 'WorkspaceProjectIdUnavailableError';
  }
}
