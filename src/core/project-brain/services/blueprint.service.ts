import type { ProjectBrainRepository } from '../storage';
import type {
  FolderOwnership,
  ProjectConstraint,
  ProjectFeature,
  ProjectGoal,
  ProjectRequirement,
  TechnologyChoice,
  VersionedProjectBrain,
} from '../types';
import { commitProjectBrainCommand, loadProjectBrain } from './project-brain-command';

export type BlueprintCommand =
  | { readonly type: 'SET_VISION'; readonly vision: string }
  | { readonly type: 'ADD_GOAL'; readonly goal: ProjectGoal }
  | { readonly type: 'ADD_FEATURE'; readonly feature: ProjectFeature }
  | { readonly type: 'ADD_REQUIREMENT'; readonly requirement: ProjectRequirement }
  | { readonly type: 'ADD_CONSTRAINT'; readonly constraint: ProjectConstraint }
  | { readonly type: 'SET_TECHNOLOGY'; readonly technology: TechnologyChoice }
  | { readonly type: 'ASSIGN_FOLDER_OWNERSHIP'; readonly ownership: FolderOwnership };

export class BlueprintService {
  constructor(private readonly repository: ProjectBrainRepository) {}

  async execute(projectId: string, command: BlueprintCommand): Promise<VersionedProjectBrain> {
    const current = await loadProjectBrain(this.repository, projectId);
    const blueprint = current.brain.blueprint;

    const updatedBlueprint = (() => {
      switch (command.type) {
        case 'SET_VISION':
          return { ...blueprint, vision: command.vision };
        case 'ADD_GOAL':
          return { ...blueprint, goals: [...blueprint.goals, command.goal] };
        case 'ADD_FEATURE':
          return { ...blueprint, features: [...blueprint.features, command.feature] };
        case 'ADD_REQUIREMENT':
          return { ...blueprint, requirements: [...blueprint.requirements, command.requirement] };
        case 'ADD_CONSTRAINT':
          return { ...blueprint, constraints: [...blueprint.constraints, command.constraint] };
        case 'SET_TECHNOLOGY':
          return {
            ...blueprint,
            techStack: [
              ...blueprint.techStack.filter(({ name }) => name !== command.technology.name),
              command.technology,
            ],
          };
        case 'ASSIGN_FOLDER_OWNERSHIP':
          return {
            ...blueprint,
            folderOwnership: [
              ...blueprint.folderOwnership.filter(({ path }) => path !== command.ownership.path),
              command.ownership,
            ],
          };
      }
    })();

    return commitProjectBrainCommand(this.repository, projectId, current, {
      ...current.brain,
      blueprint: updatedBlueprint,
    });
  }
}
