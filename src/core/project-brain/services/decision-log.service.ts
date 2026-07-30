import { parseDecisionRecord } from '../schemas';
import type { ProjectBrainRepository } from '../storage';
import { ProjectBrainRecordConflictError } from '../types';
import type { ProjectBrain, VersionedProjectBrain } from '../types';
import { commitProjectBrainCommand, loadProjectBrain } from './project-brain-command';

export class DecisionLogService {
  constructor(private readonly repository: ProjectBrainRepository) {}

  async record(projectId: string, input: unknown): Promise<VersionedProjectBrain> {
    const decision = parseDecisionRecord(input);
    const current = await loadProjectBrain(this.repository, projectId);

    if (current.brain.decisionLog.some(({ id }) => id === decision.id)) {
      throw new ProjectBrainRecordConflictError('Decision', decision.id);
    }

    const importantDecisionIds = decision.important
      ? [...current.brain.memory.importantDecisionIds, decision.id]
      : current.brain.memory.importantDecisionIds;

    const updated = {
      ...current.brain,
      decisionLog: [...current.brain.decisionLog, decision],
      memory: {
        ...current.brain.memory,
        importantDecisionIds,
        updatedAt: decision.recordedAt,
      },
    } satisfies ProjectBrain;

    return commitProjectBrainCommand(this.repository, projectId, current, updated);
  }
}
