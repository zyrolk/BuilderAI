import { ImmutableProjectIdentityError, ProjectBrainHistoryRewriteError } from '../types';
import type { ProjectBrain } from '../types';

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(rightRecord, key) && valuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function assertPrefix<T>(previous: readonly T[], next: readonly T[], historyPath: string): void {
  if (
    next.length < previous.length ||
    previous.some((entry, index) => !valuesEqual(entry, next[index]))
  ) {
    throw new ProjectBrainHistoryRewriteError(historyPath);
  }
}

export function assertProjectBrainEvolution(previous: ProjectBrain, next: ProjectBrain): void {
  const expectedProjectId = previous.blueprint.projectId;
  const receivedProjectId = next.blueprint.projectId;
  if (expectedProjectId !== receivedProjectId) {
    throw new ImmutableProjectIdentityError(expectedProjectId, receivedProjectId);
  }

  if (previous.schemaVersion !== next.schemaVersion) {
    throw new ProjectBrainHistoryRewriteError('schemaVersion');
  }

  assertPrefix(previous.decisionLog, next.decisionLog, 'decisionLog');
  assertPrefix(
    previous.progressLog.completedSprints,
    next.progressLog.completedSprints,
    'progressLog.completedSprints',
  );
  assertPrefix(previous.memory.completedWork, next.memory.completedWork, 'memory.completedWork');

  const nextTasksById = new Map(next.tasks.map((task) => [task.id, task]));
  for (const previousTask of previous.tasks) {
    const nextTask = nextTasksById.get(previousTask.id);
    if (nextTask === undefined || nextTask.createdAt !== previousTask.createdAt) {
      throw new ProjectBrainHistoryRewriteError(`tasks.${previousTask.id}.identity`);
    }
  }
}
