import {
  PROJECT_BRAIN_SCHEMA_VERSION,
  parseProjectBrain,
  type ProjectBrain,
} from '../project-brain';
import type { TargetProjectManifest } from './target-project-manifest.types';

export function createSyntheticProjectBrain(
  manifest: TargetProjectManifest,
  timestamp: string,
): ProjectBrain {
  return {
    schemaVersion: PROJECT_BRAIN_SCHEMA_VERSION,
    blueprint: {
      projectId: manifest.projectId,
      name: manifest.name,
      vision: manifest.vision,
      goals: [
        {
          id: `${manifest.projectId}-primary-goal`,
          statement: manifest.vision,
          successCriteria: [
            'Preserve existing application behavior while completing scoped BuilderAI tasks.',
          ],
        },
      ],
      features: [],
      requirements: [],
      constraints: manifest.constraints ?? [],
      techStack: [],
      folderOwnership: manifest.folderOwnership ?? [],
    },
    memory: {
      completedWork: [],
      pendingWork: [],
      importantDecisionIds: [],
      architecturalRules: [],
      updatedAt: timestamp,
    },
    decisionLog: [],
    progressLog: {
      currentMilestone: manifest.currentMilestone,
      completedSprints: [],
      completedTaskIds: [],
      updatedAt: timestamp,
    },
    tasks: [],
    domainGlossary: {
      terms: [],
      updatedAt: timestamp,
    },
  };
}

export function loadProjectBrainForTarget(
  manifest: TargetProjectManifest,
  optionalBrain: unknown | undefined,
  timestamp: string,
): ProjectBrain {
  if (optionalBrain !== undefined) {
    const parsed = parseProjectBrain(optionalBrain);
    if (parsed.blueprint.projectId !== manifest.projectId) {
      throw new Error(
        'project-brain.json projectId must match .builderai/target-project.json projectId.',
      );
    }
    return parsed;
  }
  return createSyntheticProjectBrain(manifest, timestamp);
}
