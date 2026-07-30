import { parseProjectTask } from '../schemas';
import type { ProjectBrainRepository } from '../storage';
import {
  InvalidTaskTransitionError,
  ProjectBrainRecordConflictError,
  ProjectTaskNotFoundError,
} from '../types';
import type { ProjectBrain, ProjectTask, TaskStatus, VersionedProjectBrain } from '../types';
import { commitProjectBrainCommand, loadProjectBrain } from './project-brain-command';

export type Clock = () => string;

const ALLOWED_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  TODO: ['IN_PROGRESS', 'BLOCKED'],
  IN_PROGRESS: ['TODO', 'DONE', 'BLOCKED'],
  DONE: ['TODO'],
  BLOCKED: ['TODO', 'IN_PROGRESS'],
};

function systemClock(): string {
  return new Date().toISOString();
}

function transitionTask(
  task: ProjectTask,
  nextStatus: TaskStatus,
  changedAt: string,
  blockerReason?: string,
): ProjectTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: nextStatus,
    priority: task.priority,
    acceptanceCriteria: task.acceptanceCriteria,
    dependencyIds: task.dependencyIds,
    createdAt: task.createdAt,
    updatedAt: changedAt,
    ...(nextStatus === 'BLOCKED' ? { blockerReason } : {}),
    ...(nextStatus === 'DONE' ? { completedAt: changedAt } : {}),
  };
}

export class TaskService {
  constructor(
    private readonly repository: ProjectBrainRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async add(projectId: string, input: unknown): Promise<VersionedProjectBrain> {
    const task = parseProjectTask(input);
    const current = await loadProjectBrain(this.repository, projectId);
    if (current.brain.tasks.some(({ id }) => id === task.id)) {
      throw new ProjectBrainRecordConflictError('Task', task.id);
    }

    const updated = { ...current.brain, tasks: [...current.brain.tasks, task] };
    return commitProjectBrainCommand(this.repository, projectId, current, updated);
  }

  async transition(
    projectId: string,
    taskId: string,
    nextStatus: TaskStatus,
    blockerReason?: string,
  ): Promise<VersionedProjectBrain> {
    const current = await loadProjectBrain(this.repository, projectId);
    const task = current.brain.tasks.find(({ id }) => id === taskId);
    if (task === undefined) throw new ProjectTaskNotFoundError(taskId);
    if (task.status === nextStatus) return current;

    if (!ALLOWED_TRANSITIONS[task.status].includes(nextStatus)) {
      throw new InvalidTaskTransitionError(taskId, task.status, nextStatus);
    }
    if (nextStatus === 'BLOCKED' && blockerReason?.trim() === '') {
      throw new InvalidTaskTransitionError(
        taskId,
        task.status,
        nextStatus,
        `Task '${taskId}' requires a blocker reason.`,
      );
    }
    if (nextStatus === 'BLOCKED' && blockerReason === undefined) {
      throw new InvalidTaskTransitionError(
        taskId,
        task.status,
        nextStatus,
        `Task '${taskId}' requires a blocker reason.`,
      );
    }

    if (nextStatus === 'DONE') {
      const tasksById = new Map(current.brain.tasks.map((candidate) => [candidate.id, candidate]));
      const incompleteDependency = task.dependencyIds.find(
        (dependencyId) => tasksById.get(dependencyId)?.status !== 'DONE',
      );
      if (incompleteDependency !== undefined) {
        throw new InvalidTaskTransitionError(
          taskId,
          task.status,
          nextStatus,
          `Task '${taskId}' cannot be completed before dependency '${incompleteDependency}'.`,
        );
      }
    }

    const changedAt = this.clock();
    const changedTask = transitionTask(task, nextStatus, changedAt, blockerReason);
    const completedTaskIds =
      nextStatus === 'DONE'
        ? [...new Set([...current.brain.progressLog.completedTaskIds, taskId])]
        : current.brain.progressLog.completedTaskIds.filter(
            (completedId) => completedId !== taskId,
          );

    const updated = {
      ...current.brain,
      tasks: current.brain.tasks.map((candidate) =>
        candidate.id === taskId ? changedTask : candidate,
      ),
      progressLog: {
        ...current.brain.progressLog,
        completedTaskIds,
        updatedAt: changedAt,
      },
    } satisfies ProjectBrain;

    return commitProjectBrainCommand(this.repository, projectId, current, updated);
  }
}
