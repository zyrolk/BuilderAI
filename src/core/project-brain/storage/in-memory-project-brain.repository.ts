import { assertProjectBrainEvolution } from '../validators';
import { ImmutableProjectIdentityError, ProjectBrainConflictError } from '../types';
import type { ProjectBrain, VersionedProjectBrain } from '../types';
import type { ProjectBrainRepository } from './project-brain.repository';

function cloneVersionedBrain(value: VersionedProjectBrain): VersionedProjectBrain {
  return structuredClone(value);
}

export class InMemoryProjectBrainRepository implements ProjectBrainRepository {
  private readonly projects = new Map<string, VersionedProjectBrain>();

  async find(projectId: string): Promise<VersionedProjectBrain | null> {
    const current = this.projects.get(projectId);
    return current === undefined ? null : cloneVersionedBrain(current);
  }

  async create(brain: ProjectBrain): Promise<VersionedProjectBrain> {
    const projectId = brain.blueprint.projectId;
    const current = this.projects.get(projectId);
    if (current !== undefined) {
      throw new ProjectBrainConflictError(projectId, null, current.revision);
    }

    const saved = {
      brain: structuredClone(brain),
      revision: 1,
    } satisfies VersionedProjectBrain;

    this.projects.set(projectId, saved);
    return cloneVersionedBrain(saved);
  }

  async commit(
    projectId: string,
    brain: ProjectBrain,
    expectedRevision: number,
  ): Promise<VersionedProjectBrain> {
    if (brain.blueprint.projectId !== projectId) {
      throw new ImmutableProjectIdentityError(projectId, brain.blueprint.projectId);
    }

    const current = this.projects.get(projectId);
    const actualRevision = current?.revision ?? null;
    if (current === undefined || actualRevision !== expectedRevision) {
      throw new ProjectBrainConflictError(projectId, expectedRevision, actualRevision);
    }

    assertProjectBrainEvolution(current.brain, brain);
    const saved = {
      brain: structuredClone(brain),
      revision: current.revision + 1,
    } satisfies VersionedProjectBrain;
    this.projects.set(projectId, saved);
    return cloneVersionedBrain(saved);
  }
}
