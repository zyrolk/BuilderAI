import type { ProjectBrain } from '../../project-brain';
import type { ProjectRelationship } from '../types';

export class RelationshipAnalysisService {
  analyze(brain: ProjectBrain): readonly ProjectRelationship[] {
    const relationships: ProjectRelationship[] = [];

    relationships.push(
      ...brain.memory.importantDecisionIds.map<ProjectRelationship>((decisionId) => ({
        from: 'memory',
        to: `decision:${decisionId}`,
        kind: 'REFERENCES',
      })),
      ...brain.decisionLog
        .filter(({ status }) => status === 'ACCEPTED')
        .map<ProjectRelationship>((decision) => ({
          from: `decision:${decision.id}`,
          to: 'blueprint',
          kind: 'GOVERNS',
        })),
      ...brain.tasks.flatMap((task) =>
        task.dependencyIds.map<ProjectRelationship>((dependencyId) => ({
          from: `task:${task.id}`,
          to: `task:${dependencyId}`,
          kind: 'DEPENDS_ON',
        })),
      ),
      ...brain.memory.completedWork.flatMap((work) =>
        work.taskIds.map<ProjectRelationship>((taskId) => ({
          from: `completed-work:${work.id}`,
          to: `task:${taskId}`,
          kind: 'COMPLETED_BY',
        })),
      ),
      ...brain.progressLog.completedSprints.flatMap((sprint) =>
        sprint.completedTaskIds.map<ProjectRelationship>((taskId) => ({
          from: `sprint:${sprint.id}`,
          to: `task:${taskId}`,
          kind: 'COMPLETED_BY',
        })),
      ),
      ...brain.progressLog.completedTaskIds.map<ProjectRelationship>((taskId) => ({
        from: 'progress',
        to: `task:${taskId}`,
        kind: 'REFERENCES',
      })),
      ...brain.blueprint.folderOwnership.map<ProjectRelationship>((module) => ({
        from: 'blueprint',
        to: `module:${module.path}`,
        kind: 'GOVERNS',
      })),
    );

    return relationships;
  }
}
