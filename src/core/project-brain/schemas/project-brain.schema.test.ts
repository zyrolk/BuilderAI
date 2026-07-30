import {
  parseCompletedSprint,
  parseDecisionRecord,
  parseProjectBrain,
  parseProjectTask,
} from './project-brain.schema';
import { createProjectBrain, createTask, FIXED_TIME } from '../test/project-brain.fixture';
import { ProjectBrainValidationError } from '../types';

function expectValidationIssue(input: unknown, expectedPath: string): void {
  try {
    parseProjectBrain(input);
    throw new Error('Expected Project Brain validation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectBrainValidationError);
    if (error instanceof ProjectBrainValidationError) {
      expect(error.issues.some(({ path }) => path === expectedPath)).toBe(true);
    }
  }
}

describe('Project Brain schemas', () => {
  it('parses and defensively clones a valid Project Brain', () => {
    const input = createProjectBrain();
    const parsed = parseProjectBrain(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.blueprint).not.toBe(input.blueprint);
  });

  it('rejects a non-object and unsupported schema versions', () => {
    expectValidationIssue(null, '$');
    expectValidationIssue({ ...createProjectBrain(), schemaVersion: 2 }, '$.schemaVersion');
  });

  it('reports missing, unknown, and incorrectly typed fields', () => {
    const input = {
      ...createProjectBrain(),
      unexpected: true,
      blueprint: {
        ...createProjectBrain().blueprint,
        projectId: 'Not Valid',
        name: 1,
        goals: 'not-an-array',
      },
    };

    expectValidationIssue(input, '$.unexpected');
    expectValidationIssue(input, '$.blueprint.projectId');
    expectValidationIssue(input, '$.blueprint.name');
    expectValidationIssue(input, '$.blueprint.goals');
  });

  it('rejects invalid folder ownership and malformed timestamps', () => {
    const brain = createProjectBrain();
    const input = {
      ...brain,
      blueprint: {
        ...brain.blueprint,
        folderOwnership: [
          { ...brain.blueprint.folderOwnership[0], path: '../outside' },
          { ...brain.blueprint.folderOwnership[0], path: 'src\\windows' },
          { ...brain.blueprint.folderOwnership[0], path: '/absolute' },
        ],
      },
      memory: { ...brain.memory, updatedAt: 'yesterday' },
    };

    expectValidationIssue(input, '$.blueprint.folderOwnership[0].path');
    expectValidationIssue(input, '$.memory.updatedAt');
  });

  it('rejects duplicate identifiers and invalid cross-record references', () => {
    const brain = createProjectBrain();
    const input = {
      ...brain,
      blueprint: {
        ...brain.blueprint,
        goals: [brain.blueprint.goals[0], brain.blueprint.goals[0]],
      },
      memory: { ...brain.memory, importantDecisionIds: ['missing-decision'] },
      progressLog: { ...brain.progressLog, completedTaskIds: ['foundation-task'] },
    };

    expectValidationIssue(input, '$.blueprint.goals');
    expectValidationIssue(input, '$.memory.importantDecisionIds');
    expectValidationIssue(input, '$.progressLog.completedTaskIds');
  });

  it('rejects invalid and cyclic task dependencies', () => {
    const first = createTask({ id: 'first-task', dependencyIds: ['second-task'] });
    const second = createTask({ id: 'second-task', dependencyIds: ['first-task', 'missing-task'] });
    const self = createTask({ id: 'self-task', dependencyIds: ['self-task', 'self-task'] });
    const input = createProjectBrain([first, second, self]);

    expectValidationIssue(input, '$.tasks.second-task.dependencyIds');
    expectValidationIssue(input, '$.tasks.self-task.dependencyIds');
    expectValidationIssue(input, '$.tasks.first-task.dependencyIds');
  });

  it('enforces task status metadata', () => {
    expect(() => parseProjectTask(createTask({ status: 'BLOCKED' }))).toThrow(
      ProjectBrainValidationError,
    );
    expect(() =>
      parseProjectTask(createTask({ status: 'TODO', blockerReason: 'Unexpected blocker' })),
    ).toThrow(ProjectBrainValidationError);
    expect(() => parseProjectTask(createTask({ status: 'DONE' }))).toThrow(
      ProjectBrainValidationError,
    );
    expect(() => parseProjectTask(createTask({ status: 'TODO', completedAt: FIXED_TIME }))).toThrow(
      ProjectBrainValidationError,
    );
  });

  it('parses standalone task, decision, and sprint records', () => {
    const task = createTask();
    const decision = {
      id: 'clean-architecture',
      title: 'Use clean architecture',
      context: 'The Project Brain must remain independent.',
      decision: 'Use domain types and repository ports.',
      rationale: 'It isolates policy from infrastructure.',
      status: 'ACCEPTED',
      alternatives: ['Couple the model to Next.js'],
      consequences: { positive: ['Portable domain'], negative: ['More explicit boundaries'] },
      important: true,
      recordedAt: FIXED_TIME,
    };
    const sprint = {
      id: 'sprint-1',
      name: 'Project Brain Foundation',
      outcome: 'A validated Project Brain domain.',
      completedTaskIds: [],
      completedAt: FIXED_TIME,
    };

    expect(parseProjectTask(task)).toEqual(task);
    expect(parseDecisionRecord(decision)).toEqual(decision);
    expect(parseCompletedSprint(sprint)).toEqual(sprint);
    expect(() => parseDecisionRecord({ ...decision, status: 'UNKNOWN' })).toThrow(
      ProjectBrainValidationError,
    );
    expect(() => parseCompletedSprint({ ...sprint, extra: true })).toThrow(
      ProjectBrainValidationError,
    );
  });
});
