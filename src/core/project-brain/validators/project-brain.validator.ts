import {
  DECISION_STATUSES,
  GLOSSARY_CATEGORIES,
  PROJECT_BRAIN_SCHEMA_VERSION,
  ProjectBrainValidationError,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../types';
import type { CompletedSprint, DecisionRecord, ProjectBrain, ProjectTask } from '../types';
import { ValidationContext } from './validation-context';

function validateGoal(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'statement', 'successCriteria']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.statement, `${path}.statement`);
  context.stringArray(record.successCriteria, `${path}.successCriteria`);
}

function validateFeature(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'name', 'summary']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.name, `${path}.name`, { maxLength: 200 });
  context.string(record.summary, `${path}.summary`);
}

function validateRequirement(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'statement', 'acceptanceCriteria']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.statement, `${path}.statement`);
  context.stringArray(record.acceptanceCriteria, `${path}.acceptanceCriteria`);
}

function validateConstraint(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'statement', 'rationale']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.statement, `${path}.statement`);
  context.string(record.rationale, `${path}.rationale`);
}

function validateTechnology(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['name', 'version', 'purpose']);
  if (record === null) return;
  context.string(record.name, `${path}.name`, { maxLength: 100 });
  context.string(record.version, `${path}.version`, { maxLength: 100 });
  context.string(record.purpose, `${path}.purpose`);
}

function validateFolderOwnership(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['path', 'owner', 'responsibility']);
  if (record === null) return;
  if (context.string(record.path, `${path}.path`, { maxLength: 300 })) {
    const folderPath = record.path;
    if (
      folderPath.startsWith('/') ||
      folderPath.includes('\\') ||
      folderPath.split('/').includes('..')
    ) {
      context.add(`${path}.path`, 'must be a repository-relative POSIX path without traversal');
    }
  }
  context.string(record.owner, `${path}.owner`, { maxLength: 200 });
  context.string(record.responsibility, `${path}.responsibility`);
}

function validateBlueprint(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, [
    'projectId',
    'name',
    'vision',
    'goals',
    'features',
    'requirements',
    'constraints',
    'techStack',
    'folderOwnership',
  ]);
  if (record === null) return;
  context.identifier(record.projectId, `${path}.projectId`);
  context.string(record.name, `${path}.name`, { maxLength: 200 });
  context.string(record.vision, `${path}.vision`);
  context.array(record.goals, `${path}.goals`, (item, itemPath) =>
    validateGoal(item, itemPath, context),
  );
  context.array(record.features, `${path}.features`, (item, itemPath) =>
    validateFeature(item, itemPath, context),
  );
  context.array(record.requirements, `${path}.requirements`, (item, itemPath) =>
    validateRequirement(item, itemPath, context),
  );
  context.array(record.constraints, `${path}.constraints`, (item, itemPath) =>
    validateConstraint(item, itemPath, context),
  );
  context.array(record.techStack, `${path}.techStack`, (item, itemPath) =>
    validateTechnology(item, itemPath, context),
  );
  context.array(record.folderOwnership, `${path}.folderOwnership`, (item, itemPath) =>
    validateFolderOwnership(item, itemPath, context),
  );
}

function validateCompletedWork(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'summary', 'taskIds', 'completedAt']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.summary, `${path}.summary`);
  context.stringArray(record.taskIds, `${path}.taskIds`);
  context.timestamp(record.completedAt, `${path}.completedAt`);
}

function validatePendingWork(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'summary', 'priority']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.summary, `${path}.summary`);
  context.enumeration(record.priority, `${path}.priority`, TASK_PRIORITIES);
}

function validateArchitecturalRule(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'rule', 'rationale']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.rule, `${path}.rule`);
  context.string(record.rationale, `${path}.rationale`);
}

function validateMemory(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, [
    'completedWork',
    'pendingWork',
    'importantDecisionIds',
    'architecturalRules',
    'updatedAt',
  ]);
  if (record === null) return;
  context.array(record.completedWork, `${path}.completedWork`, (item, itemPath) =>
    validateCompletedWork(item, itemPath, context),
  );
  context.array(record.pendingWork, `${path}.pendingWork`, (item, itemPath) =>
    validatePendingWork(item, itemPath, context),
  );
  context.stringArray(record.importantDecisionIds, `${path}.importantDecisionIds`);
  context.array(record.architecturalRules, `${path}.architecturalRules`, (item, itemPath) =>
    validateArchitecturalRule(item, itemPath, context),
  );
  context.timestamp(record.updatedAt, `${path}.updatedAt`);
}

export function collectDecisionIssues(
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  const record = context.object(value, path, [
    'id',
    'title',
    'context',
    'decision',
    'rationale',
    'status',
    'alternatives',
    'consequences',
    'important',
    'recordedAt',
  ]);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.title, `${path}.title`, { maxLength: 300 });
  context.string(record.context, `${path}.context`);
  context.string(record.decision, `${path}.decision`);
  context.string(record.rationale, `${path}.rationale`);
  context.enumeration(record.status, `${path}.status`, DECISION_STATUSES);
  context.stringArray(record.alternatives, `${path}.alternatives`);
  context.boolean(record.important, `${path}.important`);
  context.timestamp(record.recordedAt, `${path}.recordedAt`);

  const consequences = context.object(record.consequences, `${path}.consequences`, [
    'positive',
    'negative',
  ]);
  if (consequences !== null) {
    context.stringArray(consequences.positive, `${path}.consequences.positive`);
    context.stringArray(consequences.negative, `${path}.consequences.negative`);
  }
}

export function collectSprintIssues(
  value: unknown,
  path: string,
  context: ValidationContext,
): void {
  const record = context.object(value, path, [
    'id',
    'name',
    'outcome',
    'completedTaskIds',
    'completedAt',
  ]);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.name, `${path}.name`, { maxLength: 200 });
  context.string(record.outcome, `${path}.outcome`);
  context.stringArray(record.completedTaskIds, `${path}.completedTaskIds`);
  context.timestamp(record.completedAt, `${path}.completedAt`);
}

function validateProgressLog(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, [
    'currentMilestone',
    'completedSprints',
    'completedTaskIds',
    'updatedAt',
  ]);
  if (record === null) return;
  context.string(record.currentMilestone, `${path}.currentMilestone`, { maxLength: 300 });
  context.array(record.completedSprints, `${path}.completedSprints`, (item, itemPath) =>
    collectSprintIssues(item, itemPath, context),
  );
  context.stringArray(record.completedTaskIds, `${path}.completedTaskIds`);
  context.timestamp(record.updatedAt, `${path}.updatedAt`);
}

export function collectTaskIssues(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(
    value,
    path,
    [
      'id',
      'title',
      'description',
      'status',
      'priority',
      'acceptanceCriteria',
      'dependencyIds',
      'createdAt',
      'updatedAt',
    ],
    ['blockerReason', 'completedAt'],
  );
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.title, `${path}.title`, { maxLength: 300 });
  context.string(record.description, `${path}.description`);
  context.enumeration(record.status, `${path}.status`, TASK_STATUSES);
  context.enumeration(record.priority, `${path}.priority`, TASK_PRIORITIES);
  context.stringArray(record.acceptanceCriteria, `${path}.acceptanceCriteria`);
  context.stringArray(record.dependencyIds, `${path}.dependencyIds`);
  context.timestamp(record.createdAt, `${path}.createdAt`);
  context.timestamp(record.updatedAt, `${path}.updatedAt`);

  if ('blockerReason' in record) {
    context.string(record.blockerReason, `${path}.blockerReason`);
  }
  if ('completedAt' in record) {
    context.timestamp(record.completedAt, `${path}.completedAt`);
  }

  if (record.status === 'BLOCKED' && !('blockerReason' in record)) {
    context.add(`${path}.blockerReason`, 'is required when status is BLOCKED');
  }
  if (record.status !== 'BLOCKED' && 'blockerReason' in record) {
    context.add(`${path}.blockerReason`, 'is allowed only when status is BLOCKED');
  }
  if (record.status === 'DONE' && !('completedAt' in record)) {
    context.add(`${path}.completedAt`, 'is required when status is DONE');
  }
  if (record.status !== 'DONE' && 'completedAt' in record) {
    context.add(`${path}.completedAt`, 'is allowed only when status is DONE');
  }
}

function validateGlossaryTerm(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['id', 'term', 'category', 'definition', 'aliases']);
  if (record === null) return;
  context.identifier(record.id, `${path}.id`);
  context.string(record.term, `${path}.term`, { maxLength: 200 });
  context.enumeration(record.category, `${path}.category`, GLOSSARY_CATEGORIES);
  context.string(record.definition, `${path}.definition`);
  context.stringArray(record.aliases, `${path}.aliases`);
}

function validateGlossary(value: unknown, path: string, context: ValidationContext): void {
  const record = context.object(value, path, ['terms', 'updatedAt']);
  if (record === null) return;
  context.array(record.terms, `${path}.terms`, (item, itemPath) =>
    validateGlossaryTerm(item, itemPath, context),
  );
  context.timestamp(record.updatedAt, `${path}.updatedAt`);
}

function collectIds(items: readonly { readonly id: string }[]): string[] {
  return items.map(({ id }) => id);
}

function validateTaskDependencies(brain: ProjectBrain, context: ValidationContext): void {
  const tasksById = new Map(brain.tasks.map((task) => [task.id, task]));

  for (const task of brain.tasks) {
    context.unique(task.dependencyIds, `$.tasks.${task.id}.dependencyIds`, 'dependency');
    for (const dependencyId of task.dependencyIds) {
      if (!tasksById.has(dependencyId)) {
        context.add(
          `$.tasks.${task.id}.dependencyIds`,
          `references unknown task '${dependencyId}'`,
        );
      }
      if (dependencyId === task.id) {
        context.add(`$.tasks.${task.id}.dependencyIds`, 'a task cannot depend on itself');
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (task: ProjectTask): void => {
    if (visiting.has(task.id)) {
      context.add(`$.tasks.${task.id}.dependencyIds`, 'task dependencies must not contain a cycle');
      return;
    }
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependencyId of task.dependencyIds) {
      const dependency = tasksById.get(dependencyId);
      if (dependency !== undefined) visit(dependency);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  };

  brain.tasks.forEach(visit);
}

function validateRelationships(brain: ProjectBrain, context: ValidationContext): void {
  context.unique(collectIds(brain.blueprint.goals), '$.blueprint.goals', 'goal id');
  context.unique(collectIds(brain.blueprint.features), '$.blueprint.features', 'feature id');
  context.unique(
    collectIds(brain.blueprint.requirements),
    '$.blueprint.requirements',
    'requirement id',
  );
  context.unique(
    collectIds(brain.blueprint.constraints),
    '$.blueprint.constraints',
    'constraint id',
  );
  context.unique(
    brain.blueprint.folderOwnership.map(({ path }) => path),
    '$.blueprint.folderOwnership',
    'path',
  );
  context.unique(
    collectIds(brain.memory.completedWork),
    '$.memory.completedWork',
    'completed work id',
  );
  context.unique(collectIds(brain.memory.pendingWork), '$.memory.pendingWork', 'pending work id');
  context.unique(
    collectIds(brain.memory.architecturalRules),
    '$.memory.architecturalRules',
    'rule id',
  );
  context.unique(collectIds(brain.decisionLog), '$.decisionLog', 'decision id');
  context.unique(
    collectIds(brain.progressLog.completedSprints),
    '$.progressLog.completedSprints',
    'sprint id',
  );
  context.unique(collectIds(brain.tasks), '$.tasks', 'task id');
  context.unique(collectIds(brain.domainGlossary.terms), '$.domainGlossary.terms', 'term id');

  const decisionsById = new Map(brain.decisionLog.map((decision) => [decision.id, decision]));
  for (const decisionId of brain.memory.importantDecisionIds) {
    const decision = decisionsById.get(decisionId);
    if (decision === undefined || !decision.important) {
      context.add(
        '$.memory.importantDecisionIds',
        `must reference an important decision; '${decisionId}' does not`,
      );
    }
  }

  const tasksById = new Map(brain.tasks.map((task) => [task.id, task]));
  for (const taskId of brain.progressLog.completedTaskIds) {
    if (tasksById.get(taskId)?.status !== 'DONE') {
      context.add(
        '$.progressLog.completedTaskIds',
        `must reference a DONE task; '${taskId}' does not`,
      );
    }
  }

  validateTaskDependencies(brain, context);
}

export function assertProjectBrain(value: unknown): asserts value is ProjectBrain {
  const context = new ValidationContext();
  const record = context.object(value, '$', [
    'schemaVersion',
    'blueprint',
    'memory',
    'decisionLog',
    'progressLog',
    'tasks',
    'domainGlossary',
  ]);

  if (record !== null) {
    if (record.schemaVersion !== PROJECT_BRAIN_SCHEMA_VERSION) {
      context.add('$.schemaVersion', `must equal ${PROJECT_BRAIN_SCHEMA_VERSION}`);
    }
    validateBlueprint(record.blueprint, '$.blueprint', context);
    validateMemory(record.memory, '$.memory', context);
    context.array(record.decisionLog, '$.decisionLog', (item, itemPath) =>
      collectDecisionIssues(item, itemPath, context),
    );
    validateProgressLog(record.progressLog, '$.progressLog', context);
    context.array(record.tasks, '$.tasks', (item, itemPath) =>
      collectTaskIssues(item, itemPath, context),
    );
    validateGlossary(record.domainGlossary, '$.domainGlossary', context);
  }

  if (context.issues.length === 0) {
    validateRelationships(value as ProjectBrain, context);
  }

  if (context.issues.length > 0) {
    throw new ProjectBrainValidationError(context.issues);
  }
}

function assertRecord<T>(
  value: unknown,
  collect: (value: unknown, path: string, context: ValidationContext) => void,
): asserts value is T {
  const context = new ValidationContext();
  collect(value, '$', context);
  if (context.issues.length > 0) throw new ProjectBrainValidationError(context.issues);
}

export function assertDecisionRecord(value: unknown): asserts value is DecisionRecord {
  assertRecord<DecisionRecord>(value, collectDecisionIssues);
}

export function assertProjectTask(value: unknown): asserts value is ProjectTask {
  assertRecord<ProjectTask>(value, collectTaskIssues);
}

export function assertCompletedSprint(value: unknown): asserts value is CompletedSprint {
  assertRecord<CompletedSprint>(value, collectSprintIssues);
}
