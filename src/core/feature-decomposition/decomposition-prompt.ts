import type { DecompositionContextPackage } from '../../application/workspace/decomposition-context.service';
import {
  PromptBudgetService,
  type PromptOutputContract,
  type PromptPackage,
  type PromptPackageDraft,
  type PromptSection,
  PromptPackageValidator,
  PROMPT_PACKAGE_SCHEMA_VERSION,
} from '../prompt-orchestrator';

export const DECOMPOSITION_PROMPT_MAX_CHARACTERS = 120_000 as const;

export const DECOMPOSITION_OUTPUT_CONTRACT: PromptOutputContract = {
  schemaVersion: 1,
  type: 'OBJECT',
  fields: [
    { name: 'title', description: 'Short feature title.', type: 'STRING', required: true },
    { name: 'summary', description: 'Feature summary.', type: 'STRING', required: true },
    {
      name: 'tasks',
      description: 'Ordered bounded implementation tasks.',
      type: 'ARRAY',
      required: true,
    },
  ],
  allowAdditionalFields: false,
};

export function buildDecompositionPromptPackage(
  context: DecompositionContextPackage,
  correlationId: string,
): PromptPackage {
  const contextJson = JSON.stringify(context);
  const sections: PromptSection[] = [
    {
      id: 'system',
      kind: 'SYSTEM',
      required: true,
      identity: {
        projectId: context.project.id,
        projectName: context.project.name,
        vision: context.project.vision,
        currentMilestone: context.project.milestone,
      },
      instructions: [
        {
          id: 'decompose-only',
          text: 'Produce a bounded implementation task breakdown only. Do not generate code, file contents, shell commands, or filesystem operations.',
          source: 'TEMPLATE',
        },
      ],
    },
    {
      id: 'architecture',
      kind: 'ARCHITECTURE',
      required: true,
      architecture: {
        scope: context.architecture.summary,
        principles: [],
      },
      modules: context.architecture.modules.map(({ path, responsibility }) => ({
        path,
        owner: 'project',
        responsibility,
      })),
    },
    {
      id: 'task',
      kind: 'TASK',
      required: true,
      task: {
        id: 'feature-decomposition-request',
        title: 'Decompose feature request into bounded tasks',
        description: context.featureRequest,
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        acceptanceCriteria: [
          'Return only structured planning tasks.',
          'Each task must be independently implementable in one reviewable change set.',
        ],
        dependencyIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      goals: context.goals.map((statement, index) => ({
        id: `goal-${index + 1}`,
        statement,
        successCriteria: [],
      })),
      constraints: context.constraints.map((statement, index) => ({
        id: `constraint-${index + 1}`,
        statement,
        rationale: statement,
      })),
    },
    {
      id: 'rules',
      kind: 'RULES',
      required: true,
      instructions: [
        {
          id: 'bounded-context',
          text: `Use this bounded repository context as authority: ${contextJson}`,
          source: 'TEMPLATE',
        },
        {
          id: 'task-shape',
          text: 'Each task must include taskId, title, objective, scope, dependencyIds, expectedAreas, acceptanceCriteria, and order.',
          source: 'TEMPLATE',
        },
        {
          id: 'ownership-aligned-areas',
          text: 'Set expectedAreas to repository paths aligned with ownershipBoundaries and architecture.modules. Do not default workflow-local or application features to Project Brain paths. Target project-brain.json or src/core/project-brain only when the task explicitly changes Project Brain governance, contracts, or canonical state. .builderai is local workflow persistence when appropriate.',
          source: 'TEMPLATE',
        },
      ],
    },
    {
      id: 'context',
      kind: 'CONTEXT',
      required: false,
      context: {
        relatedTasks: [],
        relevantFiles: [],
        relevantDecisions: [],
        knownRisks: [],
        openBlockers: [],
        relevantDocumentation: [],
      },
    },
    {
      id: 'output-contract',
      kind: 'OUTPUT_CONTRACT',
      required: true,
      expectedOutput: DECOMPOSITION_OUTPUT_CONTRACT,
    },
    {
      id: 'safety',
      kind: 'SAFETY',
      required: true,
      instructions: [
        {
          id: 'no-code',
          text: 'Never include source code, patches, commands, environment values, or apply instructions.',
          source: 'TEMPLATE',
        },
      ],
    },
  ];

  const draft: PromptPackageDraft = {
    schemaVersion: PROMPT_PACKAGE_SCHEMA_VERSION,
    template: { id: 'builderai-decomposition', version: 1 },
    sections,
    metadata: {
      sourceContextSchemaVersion: 1,
      sourceContextCharacters: contextJson.length,
      values: { 'correlation-id': correlationId, source: 'feature-decomposition' },
    },
  };
  const packageValue = new PromptBudgetService().enforce(
    draft,
    DECOMPOSITION_PROMPT_MAX_CHARACTERS,
  );
  new PromptPackageValidator().validate(packageValue);
  return packageValue;
}

export interface RawDecompositionTask {
  readonly taskId?: string;
  readonly title?: string;
  readonly objective?: string;
  readonly scope?: string;
  readonly dependencyIds?: readonly string[];
  readonly expectedAreas?: readonly string[];
  readonly acceptanceCriteria?: readonly string[];
  readonly order?: number;
}

export interface RawDecompositionOutput {
  readonly title?: string;
  readonly summary?: string;
  readonly tasks?: readonly RawDecompositionTask[];
}

export function parseDecompositionOutput(value: unknown): RawDecompositionOutput {
  if (!isRecord(value)) throw new Error('Decomposition output must be an object.');
  return {
    title: typeof value.title === 'string' ? value.title : undefined,
    summary: typeof value.summary === 'string' ? value.summary : undefined,
    tasks: Array.isArray(value.tasks)
      ? value.tasks.filter((task): task is RawDecompositionTask => isRecord(task))
      : [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
