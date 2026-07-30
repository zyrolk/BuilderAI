import { parseProjectBrain } from '../schemas';
import type { ProjectBrainRepository } from '../storage';
import { ProjectBrainNotFoundError } from '../types';
import type { VersionedProjectBrain } from '../types';

export class ProjectBrainService {
  constructor(private readonly repository: ProjectBrainRepository) {}

  async initialize(input: unknown): Promise<VersionedProjectBrain> {
    const brain = parseProjectBrain(input);
    return this.repository.create(brain);
  }

  async get(projectId: string): Promise<VersionedProjectBrain> {
    const stored = await this.repository.find(projectId);
    if (stored === null) throw new ProjectBrainNotFoundError(projectId);
    return stored;
  }
}
