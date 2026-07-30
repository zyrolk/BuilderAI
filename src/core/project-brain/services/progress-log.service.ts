import { parseCompletedSprint } from '../schemas';
import type { ProjectBrainRepository } from '../storage';
import { ProjectBrainInvariantError, ProjectBrainRecordConflictError } from '../types';
import type { ProjectBrain, VersionedProjectBrain } from '../types';
import type { Clock } from './task.service';
import { commitProjectBrainCommand, loadProjectBrain } from './project-brain-command';

function systemClock(): string {
  return new Date().toISOString();
}

export class ProgressLogService {
  constructor(
    private readonly repository: ProjectBrainRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async setCurrentMilestone(
    projectId: string,
    currentMilestone: string,
  ): Promise<VersionedProjectBrain> {
    if (currentMilestone.trim().length === 0) {
      throw new ProjectBrainInvariantError('Current milestone must not be empty.');
    }

    const current = await loadProjectBrain(this.repository, projectId);
    const updated = {
      ...current.brain,
      progressLog: {
        ...current.brain.progressLog,
        currentMilestone,
        updatedAt: this.clock(),
      },
    } satisfies ProjectBrain;
    return commitProjectBrainCommand(this.repository, projectId, current, updated);
  }

  async completeSprint(projectId: string, input: unknown): Promise<VersionedProjectBrain> {
    const sprint = parseCompletedSprint(input);
    const current = await loadProjectBrain(this.repository, projectId);
    if (current.brain.progressLog.completedSprints.some(({ id }) => id === sprint.id)) {
      throw new ProjectBrainRecordConflictError('Sprint', sprint.id);
    }

    const completedTaskIds = new Set(current.brain.progressLog.completedTaskIds);
    const incompleteTaskId = sprint.completedTaskIds.find(
      (taskId) => !completedTaskIds.has(taskId),
    );
    if (incompleteTaskId !== undefined) {
      throw new ProjectBrainInvariantError(
        `Sprint '${sprint.id}' references incomplete task '${incompleteTaskId}'.`,
      );
    }

    const updated = {
      ...current.brain,
      progressLog: {
        ...current.brain.progressLog,
        completedSprints: [...current.brain.progressLog.completedSprints, sprint],
        updatedAt: sprint.completedAt,
      },
    } satisfies ProjectBrain;
    return commitProjectBrainCommand(this.repository, projectId, current, updated);
  }
}
