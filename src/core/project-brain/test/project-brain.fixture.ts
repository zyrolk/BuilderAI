import { PROJECT_BRAIN_SCHEMA_VERSION } from '../types';
import type { ProjectBrain, ProjectTask } from '../types';

export const FIXED_TIME = '2026-07-30T00:00:00.000Z';
export const LATER_TIME = '2026-07-31T00:00:00.000Z';

export function createTask(overrides: Partial<ProjectTask> = {}): ProjectTask {
  return {
    id: 'foundation-task',
    title: 'Build the foundation',
    description: 'Create the Project Brain foundation.',
    status: 'TODO',
    priority: 'HIGH',
    acceptanceCriteria: ['The model is validated at runtime.'],
    dependencyIds: [],
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

export function createProjectBrain(tasks: readonly ProjectTask[] = [createTask()]): ProjectBrain {
  return {
    schemaVersion: PROJECT_BRAIN_SCHEMA_VERSION,
    blueprint: {
      projectId: 'builder-ai',
      name: 'BuilderAI',
      vision: 'Build a model-independent software engineering platform.',
      goals: [
        {
          id: 'project-brain',
          statement: 'Create a permanent Project Brain.',
          successCriteria: ['Every change starts with project context.'],
        },
      ],
      features: [
        {
          id: 'brain-foundation',
          name: 'Project Brain Foundation',
          summary: 'Structured project context with runtime validation.',
        },
      ],
      requirements: [
        {
          id: 'runtime-validation',
          statement: 'Reject malformed Project Brain snapshots.',
          acceptanceCriteria: ['Invalid snapshots return path-specific issues.'],
        },
      ],
      constraints: [
        {
          id: 'no-ai',
          statement: 'Do not implement AI capabilities in Sprint 1.',
          rationale: 'The permanent context foundation must exist first.',
        },
      ],
      techStack: [
        {
          name: 'TypeScript',
          version: '6.0.3',
          purpose: 'Strict domain modeling.',
        },
      ],
      folderOwnership: [
        {
          path: 'src/core/project-brain',
          owner: 'Core architecture',
          responsibility: 'Project Brain domain and application contracts.',
        },
      ],
    },
    memory: {
      completedWork: [],
      pendingWork: [
        {
          id: 'complete-foundation',
          summary: 'Complete Sprint 1 validation.',
          priority: 'HIGH',
        },
      ],
      importantDecisionIds: [],
      architecturalRules: [
        {
          id: 'read-brain-first',
          rule: 'Read the Project Brain before changing code.',
          rationale: 'Changes must respect the project context.',
        },
      ],
      updatedAt: FIXED_TIME,
    },
    decisionLog: [],
    progressLog: {
      currentMilestone: 'Sprint 1 - Project Brain Foundation',
      completedSprints: [],
      completedTaskIds: [],
      updatedAt: FIXED_TIME,
    },
    tasks,
    domainGlossary: {
      terms: [
        {
          id: 'project-brain-term',
          term: 'Project Brain',
          category: 'BUSINESS',
          definition: 'The authoritative context for a BuilderAI project.',
          aliases: ['Brain'],
        },
      ],
      updatedAt: FIXED_TIME,
    },
  };
}
