import {
  createProjectBrain,
  createTask,
  FIXED_TIME,
  LATER_TIME,
} from '../test/project-brain.fixture';
import { InMemoryProjectBrainRepository } from '../storage';
import {
  InvalidTaskTransitionError,
  ProjectBrainConflictError,
  ProjectBrainInvariantError,
  ProjectBrainNotFoundError,
  ProjectBrainRecordConflictError,
  ProjectTaskNotFoundError,
} from '../types';
import { DecisionLogService } from './decision-log.service';
import { ProgressLogService } from './progress-log.service';
import { ProjectBrainService } from './project-brain.service';
import { TaskService } from './task.service';

function createServices() {
  const repository = new InMemoryProjectBrainRepository();
  const projectBrains = new ProjectBrainService(repository);
  return {
    repository,
    projectBrains,
    decisions: new DecisionLogService(repository),
    progress: new ProgressLogService(repository, () => LATER_TIME),
    tasks: new TaskService(repository, () => LATER_TIME),
  };
}

const importantDecision = {
  id: 'clean-architecture',
  title: 'Use clean architecture',
  context: 'The core must remain model-independent.',
  decision: 'Separate domain policy from storage.',
  rationale: 'Infrastructure can change independently.',
  status: 'ACCEPTED',
  alternatives: ['Framework coupling'],
  consequences: { positive: ['Portability'], negative: ['Additional contracts'] },
  important: true,
  recordedAt: LATER_TIME,
} as const;

describe('Project Brain services', () => {
  it('initializes, loads, and reports missing or duplicate projects', async () => {
    const { projectBrains } = createServices();
    const created = await projectBrains.initialize(createProjectBrain());

    await expect(projectBrains.get('builder-ai')).resolves.toEqual(created);
    await expect(projectBrains.get('missing')).rejects.toBeInstanceOf(ProjectBrainNotFoundError);
    await expect(projectBrains.initialize(createProjectBrain())).rejects.toBeInstanceOf(
      ProjectBrainConflictError,
    );
  });

  it('records immutable decisions and updates important memory', async () => {
    const { projectBrains, decisions } = createServices();
    await projectBrains.initialize(createProjectBrain());

    const recorded = await decisions.record('builder-ai', importantDecision);
    expect(recorded.brain.decisionLog).toEqual([importantDecision]);
    expect(recorded.brain.memory.importantDecisionIds).toEqual([importantDecision.id]);
    expect(recorded.brain.memory.updatedAt).toBe(LATER_TIME);

    await expect(decisions.record('builder-ai', importantDecision)).rejects.toBeInstanceOf(
      ProjectBrainRecordConflictError,
    );
  });

  it('does not classify ordinary decisions as important memory', async () => {
    const { projectBrains, decisions } = createServices();
    await projectBrains.initialize(createProjectBrain());

    const recorded = await decisions.record('builder-ai', {
      ...importantDecision,
      id: 'minor-choice',
      important: false,
    });
    expect(recorded.brain.memory.importantDecisionIds).toEqual([]);
  });

  it('adds tasks and rejects duplicate task identifiers', async () => {
    const { projectBrains, tasks } = createServices();
    await projectBrains.initialize(createProjectBrain([]));

    const added = await tasks.add('builder-ai', createTask());
    expect(added.brain.tasks).toHaveLength(1);
    await expect(tasks.add('builder-ai', createTask())).rejects.toBeInstanceOf(
      ProjectBrainRecordConflictError,
    );
  });

  it('enforces task transitions, blocker reasons, and missing tasks', async () => {
    const { projectBrains, tasks } = createServices();
    await projectBrains.initialize(createProjectBrain());

    await expect(tasks.transition('builder-ai', 'missing', 'IN_PROGRESS')).rejects.toBeInstanceOf(
      ProjectTaskNotFoundError,
    );
    await expect(tasks.transition('builder-ai', 'foundation-task', 'DONE')).rejects.toBeInstanceOf(
      InvalidTaskTransitionError,
    );

    const started = await tasks.transition('builder-ai', 'foundation-task', 'IN_PROGRESS');
    expect(started.brain.tasks[0]).toMatchObject({ status: 'IN_PROGRESS', updatedAt: LATER_TIME });
    const unchanged = await tasks.transition('builder-ai', 'foundation-task', 'IN_PROGRESS');
    expect(unchanged.revision).toBe(started.revision);

    await expect(tasks.transition('builder-ai', 'foundation-task', 'BLOCKED')).rejects.toThrow(
      /blocker reason/i,
    );
    await expect(
      tasks.transition('builder-ai', 'foundation-task', 'BLOCKED', '   '),
    ).rejects.toThrow(/blocker reason/i);
    const blocked = await tasks.transition(
      'builder-ai',
      'foundation-task',
      'BLOCKED',
      'Awaiting review',
    );
    expect(blocked.brain.tasks[0]).toMatchObject({
      status: 'BLOCKED',
      blockerReason: 'Awaiting review',
    });
    const resumed = await tasks.transition('builder-ai', 'foundation-task', 'IN_PROGRESS');
    expect(resumed.brain.tasks[0]).not.toHaveProperty('blockerReason');
  });

  it('requires completed dependencies and synchronizes progress', async () => {
    const dependency = createTask({ id: 'dependency-task', status: 'IN_PROGRESS' });
    const dependent = createTask({
      id: 'dependent-task',
      status: 'IN_PROGRESS',
      dependencyIds: ['dependency-task'],
    });
    const { projectBrains, tasks } = createServices();
    await projectBrains.initialize(createProjectBrain([dependency, dependent]));

    await expect(tasks.transition('builder-ai', 'dependent-task', 'DONE')).rejects.toThrow(
      /dependency-task/,
    );
    const dependencyDone = await tasks.transition('builder-ai', 'dependency-task', 'DONE');
    expect(dependencyDone.brain.progressLog.completedTaskIds).toEqual(['dependency-task']);
    const allDone = await tasks.transition('builder-ai', 'dependent-task', 'DONE');
    expect(allDone.brain.progressLog.completedTaskIds).toEqual([
      'dependency-task',
      'dependent-task',
    ]);

    const reopened = await tasks.transition('builder-ai', 'dependent-task', 'TODO');
    expect(reopened.brain.tasks[1]).not.toHaveProperty('completedAt');
    expect(reopened.brain.progressLog.completedTaskIds).toEqual(['dependency-task']);
  });

  it('updates milestones and completes only valid sprints', async () => {
    const done = createTask({
      status: 'DONE',
      completedAt: FIXED_TIME,
    });
    const brain = {
      ...createProjectBrain([done]),
      progressLog: {
        ...createProjectBrain([done]).progressLog,
        completedTaskIds: [done.id],
      },
    };
    const { projectBrains, progress } = createServices();
    await projectBrains.initialize(brain);

    await expect(progress.setCurrentMilestone('builder-ai', '  ')).rejects.toBeInstanceOf(
      ProjectBrainInvariantError,
    );
    const milestone = await progress.setCurrentMilestone('builder-ai', 'Controlled beta');
    expect(milestone.brain.progressLog).toMatchObject({
      currentMilestone: 'Controlled beta',
      updatedAt: LATER_TIME,
    });

    const sprint = {
      id: 'sprint-1',
      name: 'Foundation',
      outcome: 'Project Brain foundation complete.',
      completedTaskIds: [done.id],
      completedAt: LATER_TIME,
    };
    const completed = await progress.completeSprint('builder-ai', sprint);
    expect(completed.brain.progressLog.completedSprints).toEqual([sprint]);
    await expect(progress.completeSprint('builder-ai', sprint)).rejects.toBeInstanceOf(
      ProjectBrainRecordConflictError,
    );
  });

  it('rejects a sprint that claims incomplete tasks', async () => {
    const { projectBrains, progress } = createServices();
    await projectBrains.initialize(createProjectBrain());

    await expect(
      progress.completeSprint('builder-ai', {
        id: 'sprint-1',
        name: 'Foundation',
        outcome: 'Incomplete.',
        completedTaskIds: ['foundation-task'],
        completedAt: LATER_TIME,
      }),
    ).rejects.toBeInstanceOf(ProjectBrainInvariantError);
  });
});
