import type { ProjectBrain } from '../../project-brain';
import type { DocumentDiagnostic, ParsedMarkdownDocument } from '../types';

interface MutableFact {
  readonly label: string;
  readonly canonicalValue: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findDeclaredValue(content: string, label: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escapeRegExp(label)}(?:\\*\\*)?\\s*:\\s*(.+?)\\s*$`,
    'im',
  );
  return pattern
    .exec(content)?.[1]
    ?.replace(/^['"`]|['"`]$/g, '')
    .trim();
}

function missingReference(path: string, reference: string, target: string): DocumentDiagnostic {
  return {
    code: 'MISSING_REFERENCE',
    severity: 'ERROR',
    path,
    message: `${reference} references missing or incompatible ${target}.`,
  };
}

export class ConsistencyValidator {
  validate(
    brain: ProjectBrain,
    documents: readonly ParsedMarkdownDocument[],
  ): readonly DocumentDiagnostic[] {
    const diagnostics: DocumentDiagnostic[] = [];
    const tasksById = new Map(brain.tasks.map((task) => [task.id, task]));

    for (const work of brain.memory.completedWork) {
      for (const taskId of work.taskIds) {
        if (tasksById.get(taskId)?.status !== 'DONE') {
          diagnostics.push(
            missingReference(
              '$.memory.completedWork',
              `Completed work '${work.id}' task '${taskId}'`,
              'DONE task',
            ),
          );
        }
      }
    }

    for (const sprint of brain.progressLog.completedSprints) {
      for (const taskId of sprint.completedTaskIds) {
        if (tasksById.get(taskId)?.status !== 'DONE') {
          diagnostics.push(
            missingReference(
              '$.progressLog.completedSprints',
              `Completed sprint '${sprint.id}' task '${taskId}'`,
              'DONE task',
            ),
          );
        }
      }
    }

    for (const task of brain.tasks.filter(({ status }) => status === 'DONE')) {
      for (const dependencyId of task.dependencyIds) {
        if (tasksById.get(dependencyId)?.status !== 'DONE') {
          diagnostics.push(
            missingReference(
              '$.tasks',
              `DONE task '${task.id}' dependency '${dependencyId}'`,
              'DONE task',
            ),
          );
        }
      }
    }

    const mutableFacts: readonly MutableFact[] = [
      { label: 'Project ID', canonicalValue: brain.blueprint.projectId },
      { label: 'Project name', canonicalValue: brain.blueprint.name },
      { label: 'Vision', canonicalValue: brain.blueprint.vision },
      { label: 'Current milestone', canonicalValue: brain.progressLog.currentMilestone },
    ];

    for (const document of documents) {
      for (const fact of mutableFacts) {
        const declaredValue = findDeclaredValue(document.content, fact.label);
        if (declaredValue === undefined) continue;

        diagnostics.push({
          code:
            declaredValue === fact.canonicalValue
              ? 'DUPLICATED_MUTABLE_STATE'
              : 'CONFLICTING_INFORMATION',
          severity: 'ERROR',
          path: document.path,
          message:
            declaredValue === fact.canonicalValue
              ? `${fact.label} duplicates mutable canonical state from project-brain.json.`
              : `${fact.label} conflicts with project-brain.json.`,
        });
      }
    }

    return diagnostics;
  }
}
