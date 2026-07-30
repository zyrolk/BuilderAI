import type { CompletedSprint, DecisionRecord, ProjectBrain, ProjectTask } from '../types';
import {
  assertCompletedSprint,
  assertDecisionRecord,
  assertProjectBrain,
  assertProjectTask,
} from '../validators';

function cloneValidated<T>(value: T): T {
  return structuredClone(value);
}

export function parseProjectBrain(value: unknown): ProjectBrain {
  assertProjectBrain(value);
  return cloneValidated(value);
}

export function parseDecisionRecord(value: unknown): DecisionRecord {
  assertDecisionRecord(value);
  return cloneValidated(value);
}

export function parseProjectTask(value: unknown): ProjectTask {
  assertProjectTask(value);
  return cloneValidated(value);
}

export function parseCompletedSprint(value: unknown): CompletedSprint {
  assertCompletedSprint(value);
  return cloneValidated(value);
}
