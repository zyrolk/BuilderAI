import type { ProjectBrain, VersionedProjectBrain } from '../types';

export interface ProjectBrainRepository {
  find(projectId: string): Promise<VersionedProjectBrain | null>;
  create(brain: ProjectBrain): Promise<VersionedProjectBrain>;
  commit(
    projectId: string,
    brain: ProjectBrain,
    expectedRevision: number,
  ): Promise<VersionedProjectBrain>;
}
