import { CONTEXT_PRIORITIES } from '../types';
import { CONTEXT_PRIORITY_RANK, MANDATORY_DOCUMENT_KINDS } from '../config';
import { contentFingerprint } from '../internal/text-relevance';
import type { ContextLimits, ContextPackage, ContextValidationIssue } from '../types';
import { ContextBuilderValidationError } from '../types';

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

function addDuplicateIssues(
  values: readonly string[],
  path: string,
  issues: ContextValidationIssue[],
): void {
  for (const duplicate of duplicates(values)) {
    issues.push({
      code: 'DUPLICATE_CONTEXT',
      path,
      message: `contains duplicate '${duplicate}'`,
    });
  }
}

export class ContextPackageValidator {
  validate(packageValue: ContextPackage, limits: ContextLimits): void {
    const issues: ContextValidationIssue[] = [];

    if (JSON.stringify(packageValue.priorityOrder) !== JSON.stringify(CONTEXT_PRIORITIES)) {
      issues.push({
        code: 'CONFLICTING_CONTEXT',
        path: '$.priorityOrder',
        message: 'does not match the canonical context priority order',
      });
    }
    if (
      packageValue.projectIdentity.id.length === 0 ||
      packageValue.projectIdentity.name.length === 0 ||
      packageValue.projectIdentity.vision.length === 0
    ) {
      issues.push({
        code: 'MISSING_REQUIRED_CONTEXT',
        path: '$.projectIdentity',
        message: 'project identity, name, and vision are required',
      });
    }
    if (packageValue.currentMilestone.length === 0) {
      issues.push({
        code: 'MISSING_REQUIRED_CONTEXT',
        path: '$.currentMilestone',
        message: 'current milestone is required',
      });
    }
    if (
      packageValue.architectureSummary.scope.length === 0 ||
      packageValue.architectureSummary.principles.length === 0
    ) {
      issues.push({
        code: 'MISSING_REQUIRED_CONTEXT',
        path: '$.architectureSummary',
        message: 'architecture scope and principles are required',
      });
    }
    if (packageValue.goals.length === 0 || packageValue.codingStandards.length === 0) {
      issues.push({
        code: 'MISSING_REQUIRED_CONTEXT',
        path: '$',
        message: 'at least one goal and coding-standard section are required',
      });
    }

    const documentKinds = new Set(packageValue.relevantDocumentation.map(({ kind }) => kind));
    for (const kind of MANDATORY_DOCUMENT_KINDS) {
      if (!documentKinds.has(kind)) {
        issues.push({
          code: 'MISSING_REQUIRED_CONTEXT',
          path: '$.relevantDocumentation',
          message: `mandatory document '${kind}' is missing`,
        });
      }
    }

    addDuplicateIssues(
      packageValue.goals.map(({ id }) => id),
      '$.goals',
      issues,
    );
    addDuplicateIssues(
      packageValue.constraints.map(({ id }) => id),
      '$.constraints',
      issues,
    );
    addDuplicateIssues(
      packageValue.relatedTasks.map(({ id }) => id),
      '$.relatedTasks',
      issues,
    );
    addDuplicateIssues(
      packageValue.relevantModules.map(({ path }) => path),
      '$.relevantModules',
      issues,
    );
    addDuplicateIssues(
      packageValue.relevantFiles.map(({ path }) => path),
      '$.relevantFiles',
      issues,
    );
    addDuplicateIssues(
      packageValue.relevantDecisions.map(({ id }) => id),
      '$.relevantDecisions',
      issues,
    );
    addDuplicateIssues(
      packageValue.relevantDocumentation.map(({ path }) => path),
      '$.relevantDocumentation',
      issues,
    );
    addDuplicateIssues(
      packageValue.knownRisks.map(({ id }) => id),
      '$.knownRisks',
      issues,
    );

    for (let index = 1; index < packageValue.relevantDocumentation.length; index += 1) {
      const previous = packageValue.relevantDocumentation[index - 1];
      const current = packageValue.relevantDocumentation[index];
      if (
        previous !== undefined &&
        current !== undefined &&
        CONTEXT_PRIORITY_RANK[previous.priority] > CONTEXT_PRIORITY_RANK[current.priority]
      ) {
        issues.push({
          code: 'CONFLICTING_CONTEXT',
          path: '$.relevantDocumentation',
          message: 'documents are not ordered by canonical priority',
        });
        break;
      }
    }
    addDuplicateIssues(
      [
        ...packageValue.relevantFiles.map(({ content }) => contentFingerprint(content)),
        ...packageValue.relevantDocumentation.map(({ content }) => contentFingerprint(content)),
        ...packageValue.goals.map(({ statement }) => contentFingerprint(statement)),
        ...packageValue.constraints.map(({ statement }) => contentFingerprint(statement)),
        ...packageValue.relevantDecisions.map(({ decision }) => contentFingerprint(decision)),
        ...packageValue.knownRisks.map(({ description }) => contentFingerprint(description)),
      ].filter((content) => content.length > 0),
      '$',
      issues,
    );

    const availableTaskIds = new Set([
      packageValue.currentTask.id,
      ...packageValue.relatedTasks.map(({ id }) => id),
    ]);
    if (packageValue.relatedTasks.some(({ id }) => id === packageValue.currentTask.id)) {
      issues.push({
        code: 'DUPLICATE_CONTEXT',
        path: '$.relatedTasks',
        message: 'current task must not be repeated as a related task',
      });
    }
    for (const task of [packageValue.currentTask, ...packageValue.relatedTasks]) {
      for (const dependencyId of task.dependencyIds) {
        if (!availableTaskIds.has(dependencyId)) {
          issues.push({
            code: 'INVALID_REFERENCE',
            path: '$.relatedTasks',
            message: `task '${task.id}' dependency '${dependencyId}' is absent from context`,
          });
        }
      }
    }

    const modulePaths = new Set(packageValue.relevantModules.map(({ path }) => path));
    for (const file of packageValue.relevantFiles) {
      if (file.modulePath !== undefined && !modulePaths.has(file.modulePath)) {
        issues.push({
          code: 'INVALID_REFERENCE',
          path: '$.relevantFiles',
          message: `file '${file.path}' references absent module '${file.modulePath}'`,
        });
      }
    }
    for (const blocker of packageValue.openBlockers) {
      if (!availableTaskIds.has(blocker.taskId)) {
        issues.push({
          code: 'INVALID_REFERENCE',
          path: '$.openBlockers',
          message: `blocker references absent task '${blocker.taskId}'`,
        });
      }
    }

    if (
      packageValue.size.files > limits.maxFiles ||
      packageValue.size.documents > limits.maxDocuments ||
      packageValue.size.sourcePaths > limits.maxSourcePaths ||
      packageValue.size.sourceReads > limits.maxSourceReads ||
      packageValue.size.characters > limits.maxCharacters
    ) {
      issues.push({
        code: 'CONTEXT_SIZE_EXCEEDED',
        path: '$.size',
        message: 'package exceeds its configured context limits',
      });
    }
    if (
      packageValue.size.files !== packageValue.relevantFiles.length ||
      packageValue.size.documents !== packageValue.relevantDocumentation.length ||
      packageValue.size.maxFiles !== limits.maxFiles ||
      packageValue.size.maxDocuments !== limits.maxDocuments ||
      packageValue.size.maxCharacters !== limits.maxCharacters ||
      packageValue.size.maxSourcePaths !== limits.maxSourcePaths ||
      packageValue.size.maxSourceReads !== limits.maxSourceReads
    ) {
      issues.push({
        code: 'CONFLICTING_CONTEXT',
        path: '$.size',
        message: 'size metadata does not match package contents or configured limits',
      });
    }
    if (packageValue.size.characters !== JSON.stringify(packageValue).length) {
      issues.push({
        code: 'CONFLICTING_CONTEXT',
        path: '$.size.characters',
        message: 'does not match the serialized package size',
      });
    }

    if (issues.length > 0) throw new ContextBuilderValidationError(issues);
  }
}
