import { createProjectBrain, FIXED_TIME, LATER_TIME } from '../test/project-brain.fixture';
import { InMemoryProjectBrainRepository } from '../storage';
import { ProjectBrainRecordConflictError } from '../types';
import { BlueprintService } from './blueprint.service';
import { GlossaryService } from './glossary.service';
import { MemoryService } from './memory.service';
import { ProjectBrainService } from './project-brain.service';

function createCommandServices() {
  const repository = new InMemoryProjectBrainRepository();
  return {
    brains: new ProjectBrainService(repository),
    blueprint: new BlueprintService(repository),
    glossary: new GlossaryService(repository, () => LATER_TIME),
    memory: new MemoryService(repository, () => LATER_TIME),
  };
}

describe('intent-based Project Brain commands', () => {
  it('applies named Blueprint commands without exposing project identity mutation', async () => {
    const { brains, blueprint } = createCommandServices();
    await brains.initialize(createProjectBrain());

    await blueprint.execute('builder-ai', { type: 'SET_VISION', vision: 'A revised vision.' });
    await blueprint.execute('builder-ai', {
      type: 'ADD_GOAL',
      goal: { id: 'new-goal', statement: 'A new goal.', successCriteria: ['It is measurable.'] },
    });
    await blueprint.execute('builder-ai', {
      type: 'ADD_FEATURE',
      feature: { id: 'new-feature', name: 'New feature', summary: 'A feature summary.' },
    });
    await blueprint.execute('builder-ai', {
      type: 'ADD_REQUIREMENT',
      requirement: {
        id: 'new-requirement',
        statement: 'A new requirement.',
        acceptanceCriteria: ['It passes.'],
      },
    });
    await blueprint.execute('builder-ai', {
      type: 'ADD_CONSTRAINT',
      constraint: { id: 'new-constraint', statement: 'A constraint.', rationale: 'A rationale.' },
    });
    await blueprint.execute('builder-ai', {
      type: 'SET_TECHNOLOGY',
      technology: { name: 'TypeScript', version: 'manifest-managed', purpose: 'Domain contracts.' },
    });
    const updated = await blueprint.execute('builder-ai', {
      type: 'ASSIGN_FOLDER_OWNERSHIP',
      ownership: { path: 'src/core', owner: 'Architecture', responsibility: 'Core policy.' },
    });

    expect(updated.brain.blueprint).toMatchObject({
      projectId: 'builder-ai',
      vision: 'A revised vision.',
    });
    expect(updated.brain.blueprint.goals.at(-1)?.id).toBe('new-goal');
    expect(updated.brain.blueprint.features.at(-1)?.id).toBe('new-feature');
    expect(updated.brain.blueprint.requirements.at(-1)?.id).toBe('new-requirement');
    expect(updated.brain.blueprint.constraints.at(-1)?.id).toBe('new-constraint');
    expect(updated.brain.blueprint.techStack).toContainEqual({
      name: 'TypeScript',
      version: 'manifest-managed',
      purpose: 'Domain contracts.',
    });
    expect(updated.brain.blueprint.folderOwnership.at(-1)?.path).toBe('src/core');
  });

  it('uses explicit Memory commands and preserves completed work', async () => {
    const { brains, memory } = createCommandServices();
    await brains.initialize(createProjectBrain());

    await memory.execute('builder-ai', {
      type: 'ADD_PENDING_WORK',
      pendingWork: { id: 'pending-item', summary: 'Pending.', priority: 'MEDIUM' },
    });
    const completed = {
      id: 'completed-item',
      summary: 'Completed.',
      taskIds: [],
      completedAt: FIXED_TIME,
    } as const;
    const resolved = await memory.execute('builder-ai', {
      type: 'COMPLETE_PENDING_WORK',
      pendingWorkId: 'pending-item',
      completedWork: completed,
    });
    expect(resolved.brain.memory.pendingWork.some(({ id }) => id === 'pending-item')).toBe(false);
    expect(resolved.brain.memory.completedWork).toContainEqual(completed);
    expect(resolved.brain.memory.updatedAt).toBe(LATER_TIME);

    const recorded = await memory.execute('builder-ai', {
      type: 'RECORD_COMPLETED_WORK',
      completedWork: { ...completed, id: 'another-completed-item' },
    });
    expect(recorded.brain.memory.completedWork).toHaveLength(2);
    const ruled = await memory.execute('builder-ai', {
      type: 'ADD_ARCHITECTURAL_RULE',
      rule: { id: 'new-rule', rule: 'A rule.', rationale: 'A rationale.' },
    });
    expect(ruled.brain.memory.architecturalRules.at(-1)?.id).toBe('new-rule');
  });

  it('rejects invalid Memory command identities', async () => {
    const { brains, memory } = createCommandServices();
    await brains.initialize(createProjectBrain());

    await expect(
      memory.execute('builder-ai', {
        type: 'ADD_PENDING_WORK',
        pendingWork: {
          id: 'complete-foundation',
          summary: 'Complete Sprint 1 validation.',
          priority: 'HIGH',
        },
      }),
    ).rejects.toBeInstanceOf(ProjectBrainRecordConflictError);
    await expect(
      memory.execute('builder-ai', {
        type: 'COMPLETE_PENDING_WORK',
        pendingWorkId: 'missing-work',
        completedWork: {
          id: 'completed-item',
          summary: 'Completed.',
          taskIds: [],
          completedAt: FIXED_TIME,
        },
      }),
    ).rejects.toBeInstanceOf(ProjectBrainRecordConflictError);
  });

  it('defines and deliberately revises glossary terms', async () => {
    const { brains, glossary } = createCommandServices();
    await brains.initialize(createProjectBrain());

    const term = {
      id: 'command-term',
      term: 'Command',
      category: 'TECHNICAL' as const,
      definition: 'An explicit domain intent.',
      aliases: [],
    };
    await glossary.execute('builder-ai', { type: 'DEFINE_TERM', term });
    const revised = await glossary.execute('builder-ai', {
      type: 'REVISE_TERM',
      term: { ...term, definition: 'An explicit request to change domain state.' },
    });
    expect(revised.brain.domainGlossary.terms.at(-1)?.definition).toMatch(/request/);
    expect(revised.brain.domainGlossary.updatedAt).toBe(LATER_TIME);

    await expect(
      glossary.execute('builder-ai', { type: 'DEFINE_TERM', term }),
    ).rejects.toBeInstanceOf(ProjectBrainRecordConflictError);
    await expect(
      glossary.execute('builder-ai', {
        type: 'REVISE_TERM',
        term: { ...term, id: 'missing-term' },
      }),
    ).rejects.toBeInstanceOf(ProjectBrainRecordConflictError);
  });
});
