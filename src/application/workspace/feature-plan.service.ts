import type { ProjectTask } from '../../core/project-brain';
import {
  createBoundedProjectTaskId,
  FEATURE_SHADOW_TASK_ID_PREFIX,
  FEATURE_TASK_ID_PREFIX,
} from './bounded-project-task-id';
import {
  FEATURE_PLAN_LIMITS,
  FEATURE_PLAN_SCHEMA_VERSION,
  FEATURE_PLAN_STATUSES,
  FEATURE_TASK_STATUSES,
  type FeaturePlan,
  type FeaturePlanStatus,
  type FeatureTask,
  type FeatureTaskOutcome,
  type FeatureTaskStatus,
} from './feature-plan.types';
import { normalizeVerificationStages } from './feature-task-completion';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

const PLAN_ID_PATTERN = /^[A-Za-z0-9-]{8,128}$/u;
const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function normalizeFeaturePlan(
  value: unknown,
  options: {
    readonly featurePlanId?: string;
    readonly sourceRequest?: string;
    readonly now?: string;
    readonly forceStatus?: FeaturePlanStatus;
  } = {},
): FeaturePlan {
  if (!isRecord(value)) {
    throw invalidPlan('feature plan must be an object');
  }
  if (Reflect.get(value, 'schemaVersion') !== FEATURE_PLAN_SCHEMA_VERSION) {
    throw invalidPlan('feature plan schemaVersion must be 1');
  }

  const now = options.now ?? new Date().toISOString();
  const featurePlanId = normalizePlanId(
    options.featurePlanId ?? Reflect.get(value, 'featurePlanId'),
  );
  const sourceRequest = normalizeSourceRequest(
    options.sourceRequest ?? Reflect.get(value, 'sourceRequest'),
  );
  const title = normalizeTitle(Reflect.get(value, 'title'));
  const summary = normalizeSummary(Reflect.get(value, 'summary'));
  const status = normalizePlanStatus(options.forceStatus ?? Reflect.get(value, 'status'), 'DRAFT');
  const createdAt = normalizeTimestamp(Reflect.get(value, 'createdAt'), now);
  const updatedAt = normalizeTimestamp(Reflect.get(value, 'updatedAt'), now);
  const activeTaskId = normalizeOptionalTaskId(Reflect.get(value, 'activeTaskId'));
  const tasks = normalizeTasks(Reflect.get(value, 'tasks'));

  validateDependencyGraph(tasks);

  let plan: FeaturePlan = {
    schemaVersion: FEATURE_PLAN_SCHEMA_VERSION,
    featurePlanId,
    sourceRequest,
    title,
    summary,
    status,
    tasks,
    createdAt,
    updatedAt,
    ...(activeTaskId === undefined ? {} : { activeTaskId }),
  };
  plan = applyReadiness(plan);
  plan = shrinkPlanToLimit(plan);
  if (serializedPlanLength(plan) > FEATURE_PLAN_LIMITS.MAX_SERIALIZED_CHARACTERS) {
    throw invalidPlan('feature plan exceeds the 16,000 character limit after normalization');
  }
  return plan;
}

export function serializedFeaturePlanLength(plan: FeaturePlan): number {
  return serializedPlanLength(plan);
}

export function applyReadiness(plan: FeaturePlan): FeaturePlan {
  const tasksById = new Map(plan.tasks.map((task) => [task.taskId, task]));
  const tasks = plan.tasks.map((task) => {
    if (task.status === 'COMPLETED' || task.status === 'SKIPPED' || task.status === 'FAILED') {
      return task;
    }
    if (task.status === 'IN_PROGRESS') return task;
    const blocked = !dependenciesSatisfied(task, tasksById, new Set());
    if (blocked) {
      return task.status === 'PENDING' ? task : { ...task, status: 'PENDING' as const };
    }
    return task.status === 'READY' ? task : { ...task, status: 'READY' as const };
  });
  return { ...plan, tasks };
}

export function dependenciesSatisfied(
  task: FeatureTask,
  tasksById: ReadonlyMap<string, FeatureTask>,
  dependencyOverrides: ReadonlySet<string>,
): boolean {
  for (const dependencyId of task.dependencyIds) {
    const dependency = tasksById.get(dependencyId);
    if (dependency === undefined) return false;
    if (dependency.status === 'COMPLETED') continue;
    if (dependency.status === 'SKIPPED' && dependencyOverrides.has(dependencyId)) continue;
    return false;
  }
  return true;
}

export function validateTaskExecutable(
  plan: FeaturePlan,
  taskId: string,
  dependencyOverrides: readonly string[] = [],
): FeatureTask {
  if (plan.status !== 'APPROVED' && plan.status !== 'IN_PROGRESS') {
    throw invalidPlan('feature plan must be approved before task execution');
  }
  const task = plan.tasks.find(({ taskId: id }) => id === taskId);
  if (task === undefined) throw invalidPlan(`unknown task '${taskId}'`);
  if (task.status !== 'READY' && task.status !== 'IN_PROGRESS') {
    throw invalidPlan(`task '${taskId}' is not ready for execution`);
  }
  const overrides = new Set(dependencyOverrides);
  const tasksById = new Map(plan.tasks.map((entry) => [entry.taskId, entry]));
  if (!dependenciesSatisfied(task, tasksById, overrides)) {
    throw invalidPlan(`task '${taskId}' has unsatisfied dependencies`);
  }
  return task;
}

export function buildFeatureTaskRequest(task: FeatureTask): string {
  const criteria =
    task.acceptanceCriteria.length === 0
      ? ''
      : `\n\nAcceptance criteria:\n${task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`;
  const composed = `${task.objective}\n\nScope: ${task.scope}${criteria}`;
  return composed.length <= FEATURE_PLAN_LIMITS.MAX_SOURCE_REQUEST
    ? composed
    : composed.slice(0, FEATURE_PLAN_LIMITS.MAX_SOURCE_REQUEST);
}

export function createShadowDependencyTasks(
  plan: FeaturePlan,
  task: FeatureTask,
  timestamp: string,
): readonly ProjectTask[] {
  const tasksById = new Map(plan.tasks.map((entry) => [entry.taskId, entry]));
  return task.dependencyIds
    .map((dependencyId) => tasksById.get(dependencyId))
    .filter((dependency): dependency is FeatureTask => dependency?.status === 'COMPLETED')
    .map((dependency) => ({
      id: createBoundedProjectTaskId(FEATURE_SHADOW_TASK_ID_PREFIX, [
        plan.featurePlanId,
        dependency.taskId,
      ]),
      title: dependency.title,
      description: `${dependency.objective}\n\nScope: ${dependency.scope}`.slice(
        0,
        FEATURE_PLAN_LIMITS.MAX_OBJECTIVE,
      ),
      status: 'DONE' as const,
      priority: 'MEDIUM' as const,
      acceptanceCriteria: dependency.acceptanceCriteria.slice(0, 2),
      dependencyIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: dependency.lastOutcome?.completedAt ?? timestamp,
    }));
}

export function createFeatureTransientTask(
  plan: FeaturePlan,
  task: FeatureTask,
  request: string,
  preparationId: string,
  timestamp: string,
  shadowTasks: readonly ProjectTask[],
): ProjectTask {
  return {
    id: createBoundedProjectTaskId(FEATURE_TASK_ID_PREFIX, [
      plan.featurePlanId,
      task.taskId,
      preparationId,
    ]),
    title: task.title,
    description: request.trim().length > 0 ? request.trim() : buildFeatureTaskRequest(task),
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    acceptanceCriteria:
      task.acceptanceCriteria.length > 0
        ? [...task.acceptanceCriteria]
        : ['Produce a validated Project Change Plan for explicit review without applying it.'],
    dependencyIds: shadowTasks.map(({ id }) => id),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeTaskOutcome(value: unknown): FeatureTaskOutcome {
  if (!isRecord(value)) throw invalidPlan('task outcome must be an object');
  const summary = normalizeOutcomeSummary(Reflect.get(value, 'summary'));
  const completedAt = normalizeTimestamp(
    Reflect.get(value, 'completedAt'),
    new Date().toISOString(),
  );
  const verificationStatus = normalizeVerificationStatus(Reflect.get(value, 'verificationStatus'));
  const verificationStages = normalizeVerificationStages(Reflect.get(value, 'verificationStages'));
  const applyStatusRaw = Reflect.get(value, 'applyStatus');
  const applyStatus = typeof applyStatusRaw === 'string' ? applyStatusRaw.slice(0, 40) : undefined;
  const changedPaths = normalizePathList(Reflect.get(value, 'changedPaths'), 8);
  const acknowledgedPartialPass = Reflect.get(value, 'acknowledgedPartialPass') === true;
  return {
    summary,
    completedAt,
    ...(verificationStatus === undefined ? {} : { verificationStatus }),
    ...(verificationStages === undefined ? {} : { verificationStages }),
    ...(applyStatus === undefined ? {} : { applyStatus }),
    ...(changedPaths.length === 0 ? {} : { changedPaths }),
    ...(acknowledgedPartialPass ? { acknowledgedPartialPass: true } : {}),
  };
}

export function reopenTaskForCorrection(
  plan: FeaturePlan,
  taskId: string,
  now: string,
): FeaturePlan {
  const task = plan.tasks.find(({ taskId: id }) => id === taskId);
  if (task === undefined) throw invalidPlan(`unknown task '${taskId}'`);
  if (task.status !== 'COMPLETED') {
    throw new WorkspaceRuntimeError(
      'INVALID_FEATURE_PLAN',
      'Only completed tasks can be reopened for correction.',
    );
  }
  const next = updatePlanTasks(plan, now, (entry) => {
    if (entry.taskId === taskId) {
      return { ...entry, status: 'IN_PROGRESS' as const };
    }
    if (
      entry.dependencyIds.includes(taskId) &&
      (entry.status === 'READY' || entry.status === 'IN_PROGRESS')
    ) {
      return { ...entry, status: 'PENDING' as const };
    }
    return entry;
  });
  const planStatus = next.status === 'COMPLETED' ? ('IN_PROGRESS' as const) : next.status;
  return applyReadiness({ ...next, status: planStatus, activeTaskId: taskId });
}

export function markTaskInProgress(plan: FeaturePlan, taskId: string, now: string): FeaturePlan {
  return updatePlanTasks(plan, now, (task) =>
    task.taskId === taskId ? { ...task, status: 'IN_PROGRESS' } : task,
  );
}

export function restoreTaskStatus(
  plan: FeaturePlan,
  taskId: string,
  previousStatus: FeatureTaskStatus,
  now: string,
): FeaturePlan {
  return applyReadiness(
    updatePlanTasks(plan, now, (task) =>
      task.taskId === taskId ? { ...task, status: previousStatus } : task,
    ),
  );
}

export function markTaskOutcome(
  plan: FeaturePlan,
  taskId: string,
  status: FeatureTaskStatus,
  outcome: FeatureTaskOutcome | undefined,
  now: string,
): FeaturePlan {
  let next = updatePlanTasks(plan, now, (task) =>
    task.taskId === taskId
      ? {
          ...task,
          status,
          ...(outcome === undefined ? {} : { lastOutcome: outcome }),
        }
      : task,
  );
  next = {
    ...next,
    status: next.status === 'APPROVED' ? 'IN_PROGRESS' : next.status,
    activeTaskId: status === 'IN_PROGRESS' ? taskId : undefined,
  };
  next = applyReadiness(next);
  if (
    next.tasks.every(
      ({ status: taskStatus }) => taskStatus === 'COMPLETED' || taskStatus === 'SKIPPED',
    )
  ) {
    next = { ...next, status: 'COMPLETED', activeTaskId: undefined };
  }
  return next;
}

export function invalidateApproval(plan: FeaturePlan, now: string): FeaturePlan {
  if (plan.status === 'DRAFT' || plan.status === 'CANCELLED') return plan;
  return normalizeFeaturePlan(
    { ...plan, status: 'DRAFT', updatedAt: now },
    { forceStatus: 'DRAFT', now },
  );
}

function normalizeTasks(value: unknown): readonly FeatureTask[] {
  if (!Array.isArray(value)) throw invalidPlan('tasks must be an array');
  const tasks: FeatureTask[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, FEATURE_PLAN_LIMITS.MAX_TASKS)) {
    if (!isRecord(item)) continue;
    const taskId = normalizeTaskId(Reflect.get(item, 'taskId'));
    if (seen.has(taskId)) throw invalidPlan(`duplicate task id '${taskId}'`);
    seen.add(taskId);
    tasks.push({
      taskId,
      title: normalizeTaskTitle(Reflect.get(item, 'title')),
      objective: normalizeObjective(Reflect.get(item, 'objective')),
      scope: normalizeScope(Reflect.get(item, 'scope')),
      dependencyIds: normalizeDependencyIds(Reflect.get(item, 'dependencyIds')),
      expectedAreas: normalizePathList(
        Reflect.get(item, 'expectedAreas'),
        FEATURE_PLAN_LIMITS.MAX_EXPECTED_AREAS,
      ),
      acceptanceCriteria: normalizeCriteria(Reflect.get(item, 'acceptanceCriteria')),
      order: normalizeOrder(Reflect.get(item, 'order'), tasks.length + 1),
      status: normalizeTaskStatus(Reflect.get(item, 'status'), 'PENDING'),
      ...(Reflect.get(item, 'lastOutcome') === undefined
        ? {}
        : { lastOutcome: normalizeTaskOutcome(Reflect.get(item, 'lastOutcome')) }),
    });
  }
  if (tasks.length === 0) throw invalidPlan('at least one task is required');
  return tasks.sort(
    (left, right) => left.order - right.order || left.taskId.localeCompare(right.taskId),
  );
}

function validateDependencyGraph(tasks: readonly FeatureTask[]): void {
  const ids = new Set(tasks.map(({ taskId }) => taskId));
  for (const task of tasks) {
    if (task.dependencyIds.length > FEATURE_PLAN_LIMITS.MAX_DEPENDENCIES) {
      throw invalidPlan(`task '${task.taskId}' exceeds dependency limit`);
    }
    for (const dependencyId of task.dependencyIds) {
      if (!ids.has(dependencyId)) {
        throw invalidPlan(`task '${task.taskId}' references missing dependency '${dependencyId}'`);
      }
      if (dependencyId === task.taskId) {
        throw invalidPlan(`task '${task.taskId}' cannot depend on itself`);
      }
    }
  }
  for (const task of tasks) {
    if (hasCycle(task.taskId, tasks, new Set())) {
      throw invalidPlan('task dependencies must not contain a cycle');
    }
  }
}

function hasCycle(
  taskId: string,
  tasks: readonly FeatureTask[],
  visiting: Set<string>,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(taskId)) return false;
  if (visiting.has(taskId)) return true;
  visiting.add(taskId);
  const task = tasks.find(({ taskId: id }) => id === taskId);
  if (task !== undefined) {
    for (const dependencyId of task.dependencyIds) {
      if (hasCycle(dependencyId, tasks, visiting, visited)) return true;
    }
  }
  visiting.delete(taskId);
  visited.add(taskId);
  return false;
}

function updatePlanTasks(
  plan: FeaturePlan,
  now: string,
  mapper: (task: FeatureTask) => FeatureTask,
): FeaturePlan {
  return applyReadiness({
    ...plan,
    updatedAt: now,
    tasks: plan.tasks.map(mapper),
  });
}

function shrinkPlanToLimit(plan: FeaturePlan): FeaturePlan {
  if (serializedPlanLength(plan) <= FEATURE_PLAN_LIMITS.MAX_SERIALIZED_CHARACTERS) return plan;
  return {
    ...plan,
    tasks: plan.tasks.map((task) => ({
      ...task,
      expectedAreas: task.expectedAreas.slice(0, 4),
      acceptanceCriteria: task.acceptanceCriteria.slice(0, 3),
    })),
  };
}

function serializedPlanLength(plan: FeaturePlan): number {
  return JSON.stringify(plan).length;
}

function normalizePlanId(value: unknown): string {
  if (typeof value !== 'string' || !PLAN_ID_PATTERN.test(value.trim())) {
    throw invalidPlan('featurePlanId is invalid');
  }
  return value.trim();
}

function normalizeOptionalTaskId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return TASK_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

function normalizeTaskId(value: unknown): string {
  if (typeof value !== 'string') throw invalidPlan('taskId is required');
  const trimmed = value.trim().toLowerCase();
  if (!TASK_ID_PATTERN.test(trimmed) || trimmed.length > FEATURE_PLAN_LIMITS.MAX_TASK_ID_LENGTH) {
    throw invalidPlan('taskId is invalid');
  }
  return trimmed;
}

function normalizeSourceRequest(value: unknown): string {
  if (typeof value !== 'string') throw invalidPlan('sourceRequest is required');
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length === 0 || normalized.length > FEATURE_PLAN_LIMITS.MAX_SOURCE_REQUEST) {
    throw invalidPlan('sourceRequest must be between 1 and 4,000 characters');
  }
  return normalized;
}

function normalizeTitle(value: unknown): string {
  return truncateRequiredString(value, FEATURE_PLAN_LIMITS.MAX_TITLE, 'title');
}

function normalizeSummary(value: unknown): string {
  return truncateRequiredString(value, FEATURE_PLAN_LIMITS.MAX_SUMMARY, 'summary');
}

function normalizeTaskTitle(value: unknown): string {
  return truncateRequiredString(value, FEATURE_PLAN_LIMITS.MAX_TITLE, 'task title');
}

function normalizeObjective(value: unknown): string {
  return truncateRequiredString(value, FEATURE_PLAN_LIMITS.MAX_OBJECTIVE, 'objective');
}

function normalizeScope(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FEATURE_PLAN_LIMITS.MAX_SCOPE);
}

function normalizeOutcomeSummary(value: unknown): string {
  return truncateRequiredString(
    value,
    FEATURE_PLAN_LIMITS.MAX_LAST_OUTCOME_SUMMARY,
    'outcome summary',
  );
}

function normalizePlanStatus(value: unknown, fallback: FeaturePlanStatus): FeaturePlanStatus {
  if (typeof value !== 'string' || !FEATURE_PLAN_STATUSES.includes(value as FeaturePlanStatus)) {
    return fallback;
  }
  return value as FeaturePlanStatus;
}

function normalizeTaskStatus(value: unknown, fallback: FeatureTaskStatus): FeatureTaskStatus {
  if (typeof value !== 'string' || !FEATURE_TASK_STATUSES.includes(value as FeatureTaskStatus)) {
    return fallback;
  }
  return value as FeatureTaskStatus;
}

function normalizeVerificationStatus(
  value: unknown,
): FeatureTaskOutcome['verificationStatus'] | undefined {
  if (value === 'PASSED' || value === 'PARTIALLY_PASSED' || value === 'FAILED') return value;
  return undefined;
}

function normalizeDependencyIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeTaskId(item);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    ids.push(normalized);
    if (ids.length >= FEATURE_PLAN_LIMITS.MAX_DEPENDENCIES) break;
  }
  return ids;
}

function normalizeCriteria(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const criteria: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item
      .replace(/[\u0000-\u001F\u007F]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized.length === 0) continue;
    criteria.push(normalized.slice(0, FEATURE_PLAN_LIMITS.MAX_ACCEPTANCE_CRITERION));
    if (criteria.length >= FEATURE_PLAN_LIMITS.MAX_ACCEPTANCE_CRITERIA) break;
  }
  return criteria;
}

function normalizePathList(value: unknown, limit: number): readonly string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeSafePath(item);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
    if (paths.length >= limit) break;
  }
  return paths;
}

function normalizeSafePath(value: string): string | undefined {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').trim();
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeOrder(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length <= 40 ? value : fallback;
}

function truncateRequiredString(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw invalidPlan(`${label} is required`);
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length === 0) throw invalidPlan(`${label} is required`);
  return normalized.slice(0, max);
}

function invalidPlan(message: string): WorkspaceRuntimeError {
  return new WorkspaceRuntimeError('INVALID_FEATURE_PLAN', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
