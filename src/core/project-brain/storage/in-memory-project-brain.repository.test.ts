import { createProjectBrain, FIXED_TIME } from '../test/project-brain.fixture';
import {
  ImmutableProjectIdentityError,
  ProjectBrainConflictError,
  ProjectBrainHistoryRewriteError,
} from '../types';
import { InMemoryProjectBrainRepository } from './in-memory-project-brain.repository';

describe('InMemoryProjectBrainRepository', () => {
  it('returns null for a missing project and uses optimistic revisions', async () => {
    const repository = new InMemoryProjectBrainRepository();
    const brain = createProjectBrain();

    await expect(repository.find('missing')).resolves.toBeNull();
    await expect(repository.commit('builder-ai', brain, 1)).rejects.toBeInstanceOf(
      ProjectBrainConflictError,
    );

    const created = await repository.create(brain);
    expect(created.revision).toBe(1);
    await expect(repository.create(brain)).rejects.toMatchObject({
      expectedRevision: null,
      actualRevision: 1,
    });

    const updated = await repository.commit('builder-ai', brain, created.revision);
    expect(updated.revision).toBe(2);
  });

  it('isolates stored values from caller mutation', async () => {
    const repository = new InMemoryProjectBrainRepository();
    const created = await repository.create(createProjectBrain());
    const found = await repository.find('builder-ai');

    expect(found).toEqual(created);
    expect(found).not.toBe(created);
    expect(found?.brain).not.toBe(created.brain);
  });

  it('rejects project identity changes independently of submitted content', async () => {
    const repository = new InMemoryProjectBrainRepository();
    const created = await repository.create(createProjectBrain());
    const renamed = {
      ...created.brain,
      blueprint: { ...created.brain.blueprint, projectId: 'another-project' },
    };

    await expect(repository.commit('builder-ai', renamed, created.revision)).rejects.toBeInstanceOf(
      ImmutableProjectIdentityError,
    );
  });

  it('rejects removal or rewriting of append-only history', async () => {
    const repository = new InMemoryProjectBrainRepository();
    const historicalBrain = {
      ...createProjectBrain(),
      memory: {
        ...createProjectBrain().memory,
        completedWork: [
          { id: 'completed-work', summary: 'Completed.', taskIds: [], completedAt: FIXED_TIME },
        ],
      },
      decisionLog: [
        {
          id: 'architecture-decision',
          title: 'Architecture decision',
          context: 'Context.',
          decision: 'Decision.',
          rationale: 'Rationale.',
          status: 'ACCEPTED' as const,
          alternatives: [],
          consequences: { positive: [], negative: [] },
          important: false,
          recordedAt: FIXED_TIME,
        },
      ],
      progressLog: {
        ...createProjectBrain().progressLog,
        completedSprints: [
          {
            id: 'completed-sprint',
            name: 'Completed sprint',
            outcome: 'Completed.',
            completedTaskIds: [],
            completedAt: FIXED_TIME,
          },
        ],
      },
    };
    const created = await repository.create(historicalBrain);

    for (const rewritten of [
      { ...created.brain, decisionLog: [] },
      {
        ...created.brain,
        decisionLog: created.brain.decisionLog.map((decision) => ({
          ...decision,
          title: 'Rewritten architecture decision',
        })),
      },
      {
        ...created.brain,
        memory: { ...created.brain.memory, completedWork: [] },
      },
      {
        ...created.brain,
        progressLog: { ...created.brain.progressLog, completedSprints: [] },
      },
      { ...created.brain, tasks: [] },
    ]) {
      await expect(
        repository.commit('builder-ai', rewritten, created.revision),
      ).rejects.toBeInstanceOf(ProjectBrainHistoryRewriteError);
    }
  });
});
