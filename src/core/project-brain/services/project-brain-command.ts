import { parseProjectBrain } from '../schemas';
import type { ProjectBrainRepository } from '../storage';
import { ProjectBrainNotFoundError } from '../types';
import type { ProjectBrain, VersionedProjectBrain } from '../types';
import { assertProjectBrainEvolution } from '../validators';

export async function loadProjectBrain(
  repository: ProjectBrainRepository,
  projectId: string,
): Promise<VersionedProjectBrain> {
  const current = await repository.find(projectId);
  if (current === null) throw new ProjectBrainNotFoundError(projectId);
  return current;
}

export async function commitProjectBrainCommand(
  repository: ProjectBrainRepository,
  projectId: string,
  current: VersionedProjectBrain,
  candidate: unknown,
): Promise<VersionedProjectBrain> {
  const brain: ProjectBrain = parseProjectBrain(candidate);
  assertProjectBrainEvolution(current.brain, brain);
  return repository.commit(projectId, brain, current.revision);
}
