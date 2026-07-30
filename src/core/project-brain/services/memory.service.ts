import type { ProjectBrainRepository } from '../storage';
import { ProjectBrainRecordConflictError } from '../types';
import type {
  ArchitecturalRule,
  CompletedWork,
  PendingWork,
  VersionedProjectBrain,
} from '../types';
import type { Clock } from './task.service';
import { commitProjectBrainCommand, loadProjectBrain } from './project-brain-command';

export type MemoryCommand =
  | { readonly type: 'ADD_PENDING_WORK'; readonly pendingWork: PendingWork }
  | { readonly type: 'RECORD_COMPLETED_WORK'; readonly completedWork: CompletedWork }
  | {
      readonly type: 'COMPLETE_PENDING_WORK';
      readonly pendingWorkId: string;
      readonly completedWork: CompletedWork;
    }
  | { readonly type: 'ADD_ARCHITECTURAL_RULE'; readonly rule: ArchitecturalRule };

function systemClock(): string {
  return new Date().toISOString();
}

export class MemoryService {
  constructor(
    private readonly repository: ProjectBrainRepository,
    private readonly clock: Clock = systemClock,
  ) {}

  async execute(projectId: string, command: MemoryCommand): Promise<VersionedProjectBrain> {
    const current = await loadProjectBrain(this.repository, projectId);
    const memory = current.brain.memory;

    if (
      command.type === 'ADD_PENDING_WORK' &&
      memory.pendingWork.some(({ id }) => id === command.pendingWork.id)
    ) {
      throw new ProjectBrainRecordConflictError('Pending work', command.pendingWork.id);
    }
    if (
      (command.type === 'RECORD_COMPLETED_WORK' || command.type === 'COMPLETE_PENDING_WORK') &&
      memory.completedWork.some(({ id }) => id === command.completedWork.id)
    ) {
      throw new ProjectBrainRecordConflictError('Completed work', command.completedWork.id);
    }
    if (
      command.type === 'ADD_ARCHITECTURAL_RULE' &&
      memory.architecturalRules.some(({ id }) => id === command.rule.id)
    ) {
      throw new ProjectBrainRecordConflictError('Architectural rule', command.rule.id);
    }

    const updatedMemory = (() => {
      switch (command.type) {
        case 'ADD_PENDING_WORK':
          return { ...memory, pendingWork: [...memory.pendingWork, command.pendingWork] };
        case 'RECORD_COMPLETED_WORK':
          return { ...memory, completedWork: [...memory.completedWork, command.completedWork] };
        case 'COMPLETE_PENDING_WORK': {
          const pendingWorkExists = memory.pendingWork.some(
            ({ id }) => id === command.pendingWorkId,
          );
          if (!pendingWorkExists) {
            throw new ProjectBrainRecordConflictError('Pending work', command.pendingWorkId);
          }
          return {
            ...memory,
            pendingWork: memory.pendingWork.filter(({ id }) => id !== command.pendingWorkId),
            completedWork: [...memory.completedWork, command.completedWork],
          };
        }
        case 'ADD_ARCHITECTURAL_RULE':
          return {
            ...memory,
            architecturalRules: [...memory.architecturalRules, command.rule],
          };
      }
    })();

    return commitProjectBrainCommand(this.repository, projectId, current, {
      ...current.brain,
      memory: { ...updatedMemory, updatedAt: this.clock() },
    });
  }
}
