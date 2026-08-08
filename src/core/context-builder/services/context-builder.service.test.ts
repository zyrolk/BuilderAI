import { MANDATORY_DOCUMENT_KINDS } from '../config';
import { CONTEXT_PRIORITIES } from '../types';
import { ContextBuilderValidationError } from '../types';
import {
  createContextBrain,
  createContextInput,
  createSourceFiles,
  MemoryProjectFileSource,
} from '../test/context-builder.fixture';
import { ContextBuilderService } from './context-builder.service';

function issueCodes(error: unknown): readonly string[] {
  return error instanceof ContextBuilderValidationError ? error.issues.map(({ code }) => code) : [];
}

describe('ContextBuilderService', () => {
  const service = new ContextBuilderService();

  it('selects task-relevant context without loading unrelated project modules', async () => {
    const packageValue = await service.build(await createContextInput());

    expect(packageValue.projectIdentity).toMatchObject({ id: 'builder-ai', name: 'BuilderAI' });
    expect(packageValue.currentTask.id).toBe('build-context-package');
    expect(packageValue.goals.map(({ id }) => id)).toEqual(['bounded-context']);
    expect(packageValue.constraints.map(({ id }) => id)).toEqual(['no-network']);
    expect(packageValue.relevantModules.map(({ path }) => path)).toEqual([
      'src/core/context-builder',
    ]);
    expect(packageValue.relevantFiles.map(({ path }) => path)).toEqual([
      'src/core/context-builder/dependency.ts',
      'src/core/context-builder/context-builder.ts',
    ]);
    expect(packageValue.relevantDecisions.map(({ id }) => id)).toEqual(['context-boundary']);
    expect(packageValue.knownRisks).toContainEqual(
      expect.objectContaining({ id: 'pending-define-context-scale-limits' }),
    );
  });

  it('declares and applies the canonical context priority order', async () => {
    const packageValue = await service.build(await createContextInput());

    expect(packageValue.priorityOrder).toEqual(CONTEXT_PRIORITIES);
    expect(packageValue.relevantDocumentation[0]?.kind).toBe('project-constitution');
    expect(packageValue.relevantDocumentation.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['project-constitution', 'ai-rules']),
    );
    expect(MANDATORY_DOCUMENT_KINDS).toEqual(['project-constitution', 'ai-rules']);
    expect(packageValue.codingStandards.length).toBeGreaterThan(0);
  });

  it('compacts repeated Blueprint Reader diagnostics by stable diagnostic code', async () => {
    const input = await createContextInput();
    const withWarnings = {
      ...input,
      blueprintReaderOutput: {
        ...input.blueprintReaderOutput,
        diagnostics: [
          {
            code: 'UNKNOWN_DOCUMENT' as const,
            severity: 'WARNING' as const,
            message: "Unknown document 'docs/one.md'.",
            path: 'docs/one.md',
          },
          {
            code: 'UNKNOWN_DOCUMENT' as const,
            severity: 'WARNING' as const,
            message: "Unknown document 'docs/two.md'.",
            path: 'docs/two.md',
          },
        ],
      },
    };

    const packageValue = await service.build(withWarnings);

    expect(packageValue.knownRisks).toContainEqual({
      id: 'diagnostic-unknown_document',
      source: 'DOCUMENT_DIAGNOSTIC',
      severity: 'WARNING',
      description:
        "Blueprint Reader reported 2 'UNKNOWN_DOCUMENT' warnings; inspect its diagnostics for document-level details.",
    });
    expect(
      packageValue.knownRisks.filter(({ source }) => source === 'DOCUMENT_DIAGNOSTIC'),
    ).toHaveLength(1);
  });

  it('resolves transitive task dependencies and relative source imports', async () => {
    const brain = createContextBrain();
    const firstTask = brain.tasks.find(({ id }) => id === 'context-contract');
    if (firstTask === undefined) throw new Error('Fixture task is missing.');
    const prerequisite = {
      ...firstTask,
      id: 'context-prerequisite',
    };
    const updatedFirstTask = { ...firstTask, dependencyIds: ['context-prerequisite'] };
    const transitiveBrain = {
      ...brain,
      tasks: [
        prerequisite,
        updatedFirstTask,
        ...brain.tasks.filter(({ id }) => id !== 'context-contract'),
      ],
      progressLog: {
        ...brain.progressLog,
        completedTaskIds: ['context-prerequisite', 'context-contract'],
      },
    };

    const packageValue = await service.build(await createContextInput(transitiveBrain));

    expect(packageValue.relatedTasks.map(({ id }) => id)).toEqual([
      'context-prerequisite',
      'context-contract',
    ]);
    expect(packageValue.relevantFiles.map(({ path }) => path)).toContain(
      'src/core/context-builder/dependency.ts',
    );
  });

  it('deduplicates file content and records the omission', async () => {
    const files = [
      ...createSourceFiles(),
      {
        path: 'src/core/context-builder/copied-dependency.ts',
        content: 'export const resolveContextDependency = (): string => "bounded context";',
      },
    ];

    const packageValue = await service.build(await createContextInput(createContextBrain(), files));

    expect(packageValue.relevantFiles).toHaveLength(2);
    expect(packageValue.size.omissions).toContainEqual({
      kind: 'FILE',
      identifier: 'src/core/context-builder/copied-dependency.ts',
      reason: 'DUPLICATE',
    });
  });

  it('enforces file and serialized character limits deterministically', async () => {
    const inputWithoutFiles = await createContextInput(createContextBrain(), []);
    const mandatorySize = (await service.build(inputWithoutFiles)).size.characters;
    const files = Array.from({ length: 5 }, (_, index) => ({
      path: `src/core/context-builder/generated-${index}.ts`,
      content: `export const contextPackage${index} = '${'x'.repeat(2_000 + index)}';`,
    }));
    const input = await createContextInput(createContextBrain(), files);

    const packageValue = await service.build(input, {
      limitOverrides: {
        maxCharacters: mandatorySize + 700,
        maxFiles: 2,
      },
    });

    expect(packageValue.size.characters).toBeLessThanOrEqual(mandatorySize + 700);
    expect(packageValue.relevantFiles.length).toBeLessThanOrEqual(2);
    expect(packageValue.size.omissions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'FILE' })]),
    );
  });

  it('rejects a character limit too small for mandatory context', async () => {
    const input = await createContextInput(createContextBrain(), []);
    await expect(
      service.build(input, { limitOverrides: { maxCharacters: 100 } }),
    ).rejects.toBeInstanceOf(ContextBuilderValidationError);
  });

  it('reports blockers from the current task and its dependencies', async () => {
    const brain = createContextBrain();
    const tasks = brain.tasks.map((task) =>
      task.id === 'build-context-package'
        ? { ...task, status: 'BLOCKED' as const, blockerReason: 'Architecture review required.' }
        : task,
    );
    const packageValue = await service.build(await createContextInput({ ...brain, tasks }));

    expect(packageValue.openBlockers).toEqual([
      { taskId: 'build-context-package', reason: 'Architecture review required.' },
    ]);
  });

  it('returns a defensive package copy', async () => {
    const packageValue = await service.build(await createContextInput());
    const secondPackage = await service.build(await createContextInput());

    expect(packageValue).toEqual(secondPackage);
    expect(packageValue).not.toBe(secondPackage);
    expect(packageValue.currentTask).not.toBe(secondPackage.currentTask);
  });

  it('rejects conflicting Blueprint Reader output', async () => {
    const input = await createContextInput();
    const analysis = input.blueprintReaderOutput.analysis;
    if (analysis === undefined) throw new Error('Fixture analysis is missing.');
    const conflicting = {
      ...input,
      blueprintReaderOutput: {
        ...input.blueprintReaderOutput,
        analysis: { ...analysis, projectName: 'Conflicting Project' },
      },
    };

    await expect(service.build(conflicting)).rejects.toBeInstanceOf(ContextBuilderValidationError);
    try {
      await service.build(conflicting);
    } catch (error: unknown) {
      expect(issueCodes(error)).toContain('CONFLICTING_CONTEXT');
    }
  });

  it('rejects missing tasks, invalid paths, duplicate paths, and invalid limits', async () => {
    const input = await createContextInput();
    const invalid = {
      ...input,
      currentTaskId: 'missing-task',
      sourceFileSource: {
        listSourcePaths: async (): Promise<readonly string[]> => [
          '../outside.ts',
          'src/duplicate.ts',
          'src\\duplicate.ts',
        ],
        readSourceFile: async (): Promise<string> => 'unused',
      },
    };

    try {
      await service.build(invalid, { limitOverrides: { maxDocuments: 1 } });
      expect.unreachable('Expected validation to fail.');
    } catch (error: unknown) {
      expect(issueCodes(error)).toEqual(
        expect.arrayContaining(['INVALID_REFERENCE', 'DUPLICATE_CONTEXT', 'INVALID_CONTEXT_LIMIT']),
      );
    }
  });

  it('rejects invalid or incomplete Blueprint Reader output', async () => {
    const input = await createContextInput();
    const incomplete = {
      ...input,
      blueprintReaderOutput: {
        ...input.blueprintReaderOutput,
        valid: false,
        documents: input.blueprintReaderOutput.documents.filter(
          ({ kind }) => kind !== 'project-constitution',
        ),
      },
    };

    try {
      await service.build(incomplete);
      expect.unreachable('Expected validation to fail.');
    } catch (error: unknown) {
      expect(issueCodes(error)).toContain('MISSING_REQUIRED_CONTEXT');
    }
  });

  it('rejects malformed canonical state without leaking an internal error', async () => {
    const input = structuredClone(await createContextInput());
    Reflect.deleteProperty(input.projectBrain, 'blueprint');

    try {
      await service.build(input);
      expect.unreachable('Expected validation to fail.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ContextBuilderValidationError);
      expect(issueCodes(error)).toContain('INVALID_REFERENCE');
    }
  });

  it('rejects duplicate mandatory documents and document/source path collisions', async () => {
    const input = await createContextInput();
    const constitution = input.blueprintReaderOutput.documents.find(
      ({ kind }) => kind === 'project-constitution',
    );
    if (constitution === undefined) throw new Error('Fixture constitution is missing.');
    const duplicatedDocuments = input.blueprintReaderOutput.documents.map((document) =>
      document.kind === 'ai-rules' ? { ...document, content: constitution.content } : document,
    );
    const invalid = {
      ...input,
      blueprintReaderOutput: {
        ...input.blueprintReaderOutput,
        documents: duplicatedDocuments,
      },
      sourceFileSource: new MemoryProjectFileSource([
        { path: constitution.path, content: 'duplicate path' },
      ]),
    };

    try {
      await service.build(invalid);
      expect.unreachable('Expected validation to fail.');
    } catch (error: unknown) {
      expect(issueCodes(error)).toContain('DUPLICATE_CONTEXT');
    }
  });

  it('reads only relevant source files and their imports', async () => {
    const input = await createContextInput();
    const source = new MemoryProjectFileSource(createSourceFiles());
    const packageValue = await service.build({ ...input, sourceFileSource: source });

    expect(source.readPaths).toEqual([
      'src/core/context-builder/dependency.ts',
      'src/core/context-builder/context-builder.ts',
    ]);
    expect(packageValue.size.sourceReads).toBe(2);
    expect(source.readPaths).not.toContain('src/features/authentication/authentication.ts');
  });

  it('bounds source discovery and lazy reads independently from package file limits', async () => {
    const input = await createContextInput();
    const source = new MemoryProjectFileSource(createSourceFiles());
    const packageValue = await service.build(
      { ...input, sourceFileSource: source },
      { limitOverrides: { maxSourceReads: 1 } },
    );

    expect(source.readPaths).toHaveLength(1);
    expect(packageValue.size.sourceReads).toBe(1);
    expect(packageValue.size.omissions).toContainEqual(
      expect.objectContaining({ kind: 'FILE', reason: 'FILE_LIMIT' }),
    );
    expect(
      packageValue.size.omissions.filter(({ reason }) => reason === 'FILE_LIMIT'),
    ).toHaveLength(1);

    await expect(
      service.build(input, { limitOverrides: { maxSourcePaths: 1 } }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ code: 'CONTEXT_SIZE_EXCEEDED' })]),
    });
  });

  it('translates source listing and reading failures into validation errors', async () => {
    const input = await createContextInput();
    const listFailure = {
      ...input,
      sourceFileSource: {
        listSourcePaths: async (): Promise<readonly string[]> => {
          throw new Error('Catalog unavailable');
        },
        readSourceFile: async (): Promise<string> => 'unused',
      },
    };
    await expect(service.build(listFailure)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'INVALID_REFERENCE' })],
    });

    const readFailure = {
      ...input,
      sourceFileSource: {
        listSourcePaths: async (): Promise<readonly string[]> => [
          'src/core/context-builder/context-builder.ts',
        ],
        readSourceFile: async (): Promise<string> => {
          throw new Error('Read failed');
        },
      },
    };
    await expect(service.build(readFailure)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'INVALID_REFERENCE' })],
    });

    const missingImport = {
      ...input,
      sourceFileSource: new MemoryProjectFileSource([
        {
          path: 'src/core/context-builder/context-builder.ts',
          content: "import './missing-dependency';",
        },
      ]),
    };
    await expect(service.build(missingImport)).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: 'INVALID_REFERENCE' })],
    });
  });
});
