import { BlueprintReaderService } from '../../blueprint-reader';
import {
  MemoryDocumentSource,
  createDocumentSet,
} from '../../blueprint-reader/test/document-set.fixture';
import type { ProjectBrain } from '../../project-brain';
import {
  FIXED_TIME,
  createProjectBrain,
  createTask,
} from '../../project-brain/test/project-brain.fixture';
import type { ContextBuildInput, ProjectSourceFile } from '../types';
import type { ProjectFileSource } from '../ports';

export class MemoryProjectFileSource implements ProjectFileSource {
  readonly readPaths: string[] = [];
  private readonly files: ReadonlyMap<string, string>;

  constructor(sourceFiles: readonly ProjectSourceFile[]) {
    this.files = new Map(
      sourceFiles.map(({ path, content }) => [path.replaceAll('\\', '/'), content]),
    );
  }

  async listSourcePaths(): Promise<readonly string[]> {
    return [...this.files.keys()];
  }

  async readSourceFile(path: string): Promise<string> {
    this.readPaths.push(path);
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Missing source fixture '${path}'.`);
    return content;
  }
}

export function createContextBrain(): ProjectBrain {
  const dependency = createTask({
    id: 'context-contract',
    title: 'Define the context package contract',
    description: 'Define context package types and priorities.',
    status: 'DONE',
    completedAt: FIXED_TIME,
  });
  const current = createTask({
    id: 'build-context-package',
    title: 'Build a bounded context package',
    description: 'Select task context, resolve dependencies, and enforce package limits.',
    status: 'IN_PROGRESS',
    acceptanceCriteria: ['Relevant context is selected without loading unrelated modules.'],
    dependencyIds: ['context-contract'],
  });
  const unrelated = createTask({
    id: 'design-authentication',
    title: 'Design authentication',
    description: 'Future identity work.',
  });
  const base = createProjectBrain([dependency, current, unrelated]);
  return {
    ...base,
    blueprint: {
      ...base.blueprint,
      goals: [
        {
          id: 'bounded-context',
          statement: 'Build deterministic bounded project context.',
          successCriteria: ['Packages remain within configured limits.'],
        },
        {
          id: 'future-auth',
          statement: 'Define future user authentication.',
          successCriteria: ['Identity requirements are approved.'],
        },
      ],
      constraints: [
        {
          id: 'no-network',
          statement: 'Do not make network calls while building context.',
          rationale: 'Context construction must remain deterministic.',
        },
      ],
      folderOwnership: [
        {
          path: 'src/core/context-builder',
          owner: 'Domain architecture',
          responsibility: 'Bounded context package selection and dependency resolution.',
        },
        {
          path: 'src/features/authentication',
          owner: 'Identity team',
          responsibility: 'Future authentication workflows.',
        },
      ],
    },
    memory: {
      ...base.memory,
      pendingWork: [
        {
          id: 'define-context-scale-limits',
          summary: 'Define context package size and processing limits.',
          priority: 'HIGH',
        },
        {
          id: 'choose-auth-provider',
          summary: 'Choose a future authentication provider.',
          priority: 'HIGH',
        },
      ],
    },
    decisionLog: [
      {
        id: 'context-boundary',
        title: 'Use one bounded context package',
        context: 'Task context must be selected deterministically.',
        decision: 'Enforce package priorities and size limits in the core.',
        rationale: 'Downstream consumers need one validated context contract.',
        status: 'ACCEPTED',
        alternatives: ['Load the whole repository'],
        consequences: { positive: ['Bounded context'], negative: ['Selection rules'] },
        important: true,
        recordedAt: FIXED_TIME,
      },
      {
        id: 'authentication-boundary',
        title: 'Future authentication boundary',
        context: 'Identity may be required later.',
        decision: 'Defer authentication technology.',
        rationale: 'Requirements are missing.',
        status: 'ACCEPTED',
        alternatives: [],
        consequences: { positive: [], negative: [] },
        important: false,
        recordedAt: FIXED_TIME,
      },
    ],
    progressLog: {
      ...base.progressLog,
      currentMilestone: 'Context Builder Foundation',
      completedTaskIds: ['context-contract'],
    },
  };
}

export function createSourceFiles(): readonly ProjectSourceFile[] {
  return [
    {
      path: 'src/core/context-builder/context-builder.ts',
      content:
        "import { resolveContextDependency } from './dependency';\nexport const buildContextPackage = resolveContextDependency;",
    },
    {
      path: 'src/core/context-builder/dependency.ts',
      content: 'export const resolveContextDependency = (): string => "bounded context";',
    },
    {
      path: 'src/features/authentication/authentication.ts',
      content: 'export const authenticateUser = (): boolean => true;',
    },
  ];
}

export async function createContextInput(
  brain: ProjectBrain = createContextBrain(),
  sourceFiles: readonly ProjectSourceFile[] = createSourceFiles(),
): Promise<ContextBuildInput> {
  const documents = createDocumentSet();
  documents.set('project-brain.json', JSON.stringify(brain));
  const architecture = documents.get('docs/architecture.md') ?? '';
  documents.set(
    'docs/architecture.md',
    architecture.replace(
      'Policy for Status and scope.',
      'The context package core selects bounded task context.',
    ),
  );
  const result = await new BlueprintReaderService(new MemoryDocumentSource(documents)).read();
  return {
    projectBrain: brain,
    blueprintReaderOutput: result,
    currentTaskId: 'build-context-package',
    sourceFileSource: new MemoryProjectFileSource(sourceFiles),
  };
}
