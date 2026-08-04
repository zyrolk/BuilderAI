import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService } from '../../core/change-planner';
import {
  ContextBuilderService,
  DEFAULT_CONTEXT_LIMITS,
  type ProjectFileSource,
} from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import {
  VerificationEngineService,
  type VerificationStagePortResult,
} from '../../core/verification';
import { InMemoryFileSystemPort } from '../../core/file-apply/test/file-apply.fixture';
import { createPortHarness } from '../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../infrastructure/project';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../providers/openai';
import { NullWorkspaceBaselinePort } from '../../core/update-scope/test/workspace-baseline.fixture';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import { WorkspaceRuntimeService } from './workspace-runtime.service';
import { buildIterationFeedbackFromCompletion } from './iteration-feedback.service';
import type { ContextBuildInput } from '../../core/context-builder';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 30_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};
const emptySource: ProjectFileSource = {
  listSourcePaths: async () => [],
  readSourceFile: async () => {
    throw new Error('No source reads expected.');
  },
};

class RecordingContextBuilder extends ContextBuilderService {
  lastPackage?: Awaited<ReturnType<ContextBuilderService['build']>>;
  lastInput?: ContextBuildInput;

  override async build(
    input: ContextBuildInput,
    ...parameters: Parameters<ContextBuilderService['build']> extends [
      ContextBuildInput,
      ...infer Rest,
    ]
      ? Rest
      : never
  ): Promise<Awaited<ReturnType<ContextBuilderService['build']>>> {
    this.lastInput = input;
    this.lastPackage = await super.build(input, ...parameters);
    return this.lastPackage;
  }
}

/** Counts real `FileApplyEngineService.apply()` invocations so P1-6 retry tests can prove retry boundaries. */
class CountingFileApplyEngineService extends FileApplyEngineService {
  calls = 0;

  override async apply(
    ...parameters: Parameters<FileApplyEngineService['apply']>
  ): Promise<Awaited<ReturnType<FileApplyEngineService['apply']>>> {
    this.calls += 1;
    return super.apply(...parameters);
  }
}

/** Simulates an internal contract-violation exception that escapes `apply()` before any `FileApplyResult` exists. */
class ThrowingFileApplyEngineService extends FileApplyEngineService {
  override async apply(): Promise<never> {
    throw new Error('internal contract violation');
  }
}

const FAILED_STAGE_RESULT: VerificationStagePortResult = {
  status: 'FAILED',
  warnings: [],
  errors: [{ code: 'STAGE_FAILED', message: 'Simulated stage failure.' }],
  metadata: {},
};

describe('WorkspaceRuntimeService', () => {
  it('composes preparation, server-held approval, apply, verification, and idempotent replay', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const verification = createPortHarness();
    const service = createService(fileSystem, verification.ports);

    const preparation = await service.prepare('Create the approved integration artifact.');

    expect(preparation.changePlan.changeSet.operations).toHaveLength(1);
    expect(preparation.changePlan.changeSet.operations[0]?.logicalPath).toBe(
      'src/integration-output.ts',
    );
    expect(fileSystem.mutationCalls).toEqual([]);

    const completion = await service.approveAndApply(preparation.preparationId, true);
    const replay = await service.approveAndApply(preparation.preparationId, true);

    expect(completion.applyResult.status).toBe('APPLIED');
    expect(completion.verificationReport?.status).toBe('PASSED');
    expect(replay).toEqual(completion);
    expect(fileSystem.mutationCalls).toEqual(['create:src/integration-output.ts']);
    expect(verification.calls).toEqual([
      'PROJECT_VALIDATION',
      'DEPENDENCY_VALIDATION',
      'BUILD_VALIDATION',
      'TEST_VALIDATION',
    ]);
  });

  it('rejects missing approval and invalid request text before effects', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const service = createService(fileSystem, createPortHarness().ports);
    await expect(service.prepare('   ')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const preparation = await service.prepare('Create a controlled artifact.');

    await expect(service.approveAndApply(preparation.preparationId, false)).rejects.toBeInstanceOf(
      WorkspaceRuntimeError,
    );
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('keeps the maximum accepted request within the default Context Builder budget', async () => {
    const contextBuilder = new RecordingContextBuilder();
    const service = createService(
      new InMemoryFileSystemPort(),
      createPortHarness().ports,
      new NodeProjectFileSource(process.cwd()),
      contextBuilder,
    );
    const request =
      'project context builder service validators provider workspace architecture blueprint security configuration execution response planning apply verification documentation ';

    const preparation = await service.prepare(request.repeat(30).slice(0, 4_000));

    expect(preparation.changePlan.summary.totalOperations).toBe(1);
    expect(contextBuilder.lastPackage?.size.characters).toBeLessThanOrEqual(
      DEFAULT_CONTEXT_LIMITS.maxCharacters,
    );
  }, 30_000);

  it('keeps a broad Project Brain request within the default Context Builder budget', async () => {
    const contextBuilder = new RecordingContextBuilder();
    const service = createService(
      new InMemoryFileSystemPort(),
      createPortHarness().ports,
      new NodeProjectFileSource(process.cwd()),
      contextBuilder,
    );
    const request =
      'Update BuilderAI project context builder service validators types tests provider workspace runtime architecture blueprint memory decisions progress tasks security configuration execution response change planner file apply verification documentation.';

    const preparation = await service.prepare(request);

    expect(preparation.changePlan.summary.totalOperations).toBe(1);
    expect(contextBuilder.lastPackage?.size.characters).toBeLessThanOrEqual(
      DEFAULT_CONTEXT_LIMITS.maxCharacters,
    );
    expect(contextBuilder.lastPackage?.projectIdentity.id).toBe('builder-ai');
    expect(contextBuilder.lastPackage?.constraints).toEqual(
      loadCanonicalProjectBrain().blueprint.constraints,
    );
    expect(contextBuilder.lastPackage?.currentTask.description).toBe(request);
    expect(contextBuilder.lastPackage?.currentTask.acceptanceCriteria).not.toContain(request);
    expect(contextBuilder.lastPackage?.relevantDocumentation.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['project-constitution', 'ai-rules']),
    );
  }, 30_000);

  it('recovers from a single transient provider outage via the bounded retry policy (P1-5)', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    let calls = 0;
    let providerTick = 0;
    const providerClock = (): string =>
      new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
    const provider = new OpenAIProvider(
      configuration,
      {
        create: async () => {
          calls += 1;
          if (calls === 1) throw new Error('temporary network failure');
          return {
            id: 'response-integration-retry',
            model: 'integration-model',
            status: 'completed',
            output_text: JSON.stringify({
              summary: 'Created an integration artifact after one retry.',
              artifacts: [
                {
                  logicalPath: 'src/integration-output.ts',
                  type: 'SOURCE_FILE',
                  content: 'export const integrated = true;\n',
                  metadata: {
                    description: 'Create the integration artifact',
                    'change-operation': 'CREATE_FILE',
                  },
                },
              ],
              diagnostics: [],
            }),
            error: null,
            usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
          };
        },
      },
      providerClock,
    );
    const timestamp = new Date('2026-07-31T13:00:00.000Z');
    const service = new WorkspaceRuntimeService({
      loadProjectBrain: loadCanonicalProjectBrain,
      blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
      sourceFiles: emptySource,
      contextBuilder: new ContextBuilderService(),
      promptOrchestrator: new PromptOrchestratorService(),
      workspaceBaseline: new NullWorkspaceBaselinePort(),
      providerExecution: new OpenAIExecutionService(provider, configuration, providerClock),
      responseProcessor: new ResponseProcessorService(),
      changePlanner: new ChangePlannerService(),
      fileApply: new FileApplyEngineService(fileSystem),
      verification: new VerificationEngineService(createPortHarness().ports),
      clock: { now: () => new Date(timestamp) },
      ids: { generate: () => '123e4567-e89b-12d3-a456-426614174001' },
      logger: { record: () => undefined },
    });

    const preparation = await service.prepare('Create the approved integration artifact.');

    expect(calls).toBe(2);
    expect(preparation.changePlan.changeSet.operations).toHaveLength(1);
  });

  it('reclaims a preparation after a zero-mutation REJECTED Apply result and can then succeed (P1-6)', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/integration-output.ts': 'already here\n',
    });
    const fileApply = new CountingFileApplyEngineService(fileSystem);
    const service = createService(
      fileSystem,
      createPortHarness().ports,
      emptySource,
      new ContextBuilderService(),
      fileApply,
    );

    const preparation = await service.prepare('Create the approved integration artifact.');

    const first = await service.approveAndApply(preparation.preparationId, true);
    expect(first.applyResult.status).toBe('REJECTED');
    expect(first.verificationReport).toBeUndefined();
    expect(fileSystem.mutationCalls).toEqual([]);
    expect(fileApply.calls).toBe(1);

    fileSystem.files.delete('src/integration-output.ts');
    const second = await service.approveAndApply(preparation.preparationId, true);

    expect(fileApply.calls).toBe(2);
    expect(second.applyResult.status).toBe('APPLIED');
    expect(second.verificationReport?.status).toBe('PASSED');
    expect(fileSystem.mutationCalls).toEqual(['create:src/integration-output.ts']);
  });

  it('reclaims a preparation after a zero-mutation FAILED Apply result and can then succeed (P1-6)', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.failMutationPath = 'src/integration-output.ts';
    const fileApply = new CountingFileApplyEngineService(fileSystem);
    const service = createService(
      fileSystem,
      createPortHarness().ports,
      emptySource,
      new ContextBuilderService(),
      fileApply,
    );

    const preparation = await service.prepare('Create the approved integration artifact.');

    const first = await service.approveAndApply(preparation.preparationId, true);
    expect(first.applyResult.status).toBe('FAILED');
    expect(first.applyResult.createdFiles).toEqual([]);
    expect(first.applyResult.updatedFiles).toEqual([]);
    expect(first.applyResult.deletedFiles).toEqual([]);
    expect(first.verificationReport).toBeUndefined();
    expect(fileApply.calls).toBe(1);

    fileSystem.failMutationPath = undefined;
    const second = await service.approveAndApply(preparation.preparationId, true);

    expect(fileApply.calls).toBe(2);
    expect(second.applyResult.status).toBe('APPLIED');
    expect(second.verificationReport?.status).toBe('PASSED');
  });

  it('never invokes File Apply a third time once the maximum of 2 total attempts is reached (P1-6)', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/integration-output.ts': 'already here\n',
    });
    const fileApply = new CountingFileApplyEngineService(fileSystem);
    const service = createService(
      fileSystem,
      createPortHarness().ports,
      emptySource,
      new ContextBuilderService(),
      fileApply,
    );

    const preparation = await service.prepare('Create the approved integration artifact.');

    const first = await service.approveAndApply(preparation.preparationId, true);
    expect(first.applyResult.status).toBe('REJECTED');
    const second = await service.approveAndApply(preparation.preparationId, true);
    expect(second.applyResult.status).toBe('REJECTED');
    expect(fileApply.calls).toBe(2);

    fileSystem.files.delete('src/integration-output.ts');
    const third = await service.approveAndApply(preparation.preparationId, true);

    expect(fileApply.calls).toBe(2);
    expect(third).toEqual(second);
  });

  it('keeps PARTIALLY_APPLIED permanently terminal, never repeats mutations on replay, and now carries a real VerificationReport (P1-6/P1-7)', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.failMutationPath = 'src/second-output.ts';
    const fileApply = new CountingFileApplyEngineService(fileSystem);
    const verification = createPortHarness();
    let providerTick = 0;
    const providerClock = (): string =>
      new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
    const provider = new OpenAIProvider(
      configuration,
      {
        create: async () => ({
          id: 'response-partial',
          model: 'integration-model',
          status: 'completed',
          output_text: JSON.stringify({
            summary: 'Creates two artifacts.',
            artifacts: [
              {
                logicalPath: 'src/first-output.ts',
                type: 'SOURCE_FILE',
                content: 'export const first = true;\n',
                metadata: {
                  description: 'Create the first artifact',
                  'change-operation': 'CREATE_FILE',
                },
              },
              {
                logicalPath: 'src/second-output.ts',
                type: 'SOURCE_FILE',
                content: 'export const second = true;\n',
                metadata: {
                  description: 'Create the second artifact',
                  'change-operation': 'CREATE_FILE',
                },
              },
            ],
            diagnostics: [],
          }),
          error: null,
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
        }),
      },
      providerClock,
    );
    const timestamp = new Date('2026-07-31T13:00:00.000Z');
    const service = new WorkspaceRuntimeService({
      loadProjectBrain: loadCanonicalProjectBrain,
      blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
      sourceFiles: emptySource,
      contextBuilder: new ContextBuilderService(),
      promptOrchestrator: new PromptOrchestratorService(),
      workspaceBaseline: new NullWorkspaceBaselinePort(),
      providerExecution: new OpenAIExecutionService(provider, configuration, providerClock),
      responseProcessor: new ResponseProcessorService(),
      changePlanner: new ChangePlannerService(),
      fileApply,
      verification: new VerificationEngineService(verification.ports),
      clock: { now: () => new Date(timestamp) },
      ids: { generate: () => '123e4567-e89b-12d3-a456-426614174002' },
      logger: { record: () => undefined },
    });

    const preparation = await service.prepare('Create two approved integration artifacts.');
    expect(preparation.changePlan.changeSet.operations).toHaveLength(2);

    const first = await service.approveAndApply(preparation.preparationId, true);
    expect(first.applyResult.status).toBe('PARTIALLY_APPLIED');
    expect(first.applyResult.createdFiles).toEqual(['src/first-output.ts']);
    expect(first.verificationReport?.status).toBe('PASSED');
    expect(fileApply.calls).toBe(1);
    expect(verification.calls).toEqual([
      'PROJECT_VALIDATION',
      'DEPENDENCY_VALIDATION',
      'BUILD_VALIDATION',
      'TEST_VALIDATION',
    ]);

    const mutationCallsAfterFirst = [...fileSystem.mutationCalls];
    const replay = await service.approveAndApply(preparation.preparationId, true);

    expect(replay).toEqual(first);
    expect(fileApply.calls).toBe(1);
    expect(fileSystem.mutationCalls).toEqual(mutationCallsAfterFirst);
    expect(verification.calls).toHaveLength(4);
  });

  it('keeps APPLIED permanently terminal when verification FAILS and never repeats Apply (P1-6)', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const fileApply = new CountingFileApplyEngineService(fileSystem);
    const verification = createPortHarness({
      PROJECT_VALIDATION: FAILED_STAGE_RESULT,
      DEPENDENCY_VALIDATION: FAILED_STAGE_RESULT,
      BUILD_VALIDATION: FAILED_STAGE_RESULT,
      TEST_VALIDATION: FAILED_STAGE_RESULT,
    });
    const service = createService(
      fileSystem,
      verification.ports,
      emptySource,
      new ContextBuilderService(),
      fileApply,
    );

    const preparation = await service.prepare('Create the approved integration artifact.');
    const first = await service.approveAndApply(preparation.preparationId, true);
    expect(first.applyResult.status).toBe('APPLIED');
    expect(first.verificationReport?.status).toBe('FAILED');
    expect(fileApply.calls).toBe(1);

    const replay = await service.approveAndApply(preparation.preparationId, true);
    expect(replay).toEqual(first);
    expect(fileApply.calls).toBe(1);
  });

  it('keeps APPLIED permanently terminal when verification is PARTIALLY_PASSED (P1-6)', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const fileApply = new CountingFileApplyEngineService(fileSystem);
    const verification = createPortHarness({ TEST_VALIDATION: FAILED_STAGE_RESULT });
    const service = createService(
      fileSystem,
      verification.ports,
      emptySource,
      new ContextBuilderService(),
      fileApply,
    );

    const preparation = await service.prepare('Create the approved integration artifact.');
    const first = await service.approveAndApply(preparation.preparationId, true);
    expect(first.applyResult.status).toBe('APPLIED');
    expect(first.verificationReport?.status).toBe('PARTIALLY_PASSED');
    expect(fileApply.calls).toBe(1);

    const replay = await service.approveAndApply(preparation.preparationId, true);
    expect(replay).toEqual(first);
    expect(fileApply.calls).toBe(1);
  });

  it('passes iteration path hints to fresh retrieval for explicit correction prepares', async () => {
    const contextBuilder = new RecordingContextBuilder();
    const fileSystem = new InMemoryFileSystemPort();
    const service = createService(
      fileSystem,
      createPortHarness().ports,
      new NodeProjectFileSource(process.cwd()),
      contextBuilder,
      undefined,
      'src/core/context-builder/services/context-builder.service.ts',
    );
    const feedback = buildIterationFeedbackFromCompletion(
      {
        applyResult: {
          schemaVersion: 1,
          status: 'APPLIED',
          createdFiles: ['src/core/context-builder/services/context-builder.service.ts'],
          updatedFiles: [],
          deletedFiles: [],
          skippedFiles: [],
          warnings: [],
          errors: [],
          durationMs: 1,
          metadata: {},
        },
        verificationReport: {
          schemaVersion: 1,
          status: 'FAILED',
          stages: [],
          warnings: [],
          errors: [
            { code: 'BUILD_FAILED', message: 'Compilation failed.', stage: 'BUILD_VALIDATION' },
          ],
          durationMs: 1,
          metadata: {},
        },
      },
      { priorRequestSummary: 'Previous request.' },
    );

    await service.prepare('Fix the verification failures from the previous change.', feedback);

    expect(contextBuilder.lastInput?.iterationPathHints?.length).toBeGreaterThan(0);
    expect(contextBuilder.lastInput?.iterationPathHints?.length).toBeLessThanOrEqual(8);
  }, 30_000);

  it('rejects invalid iteration feedback before provider execution', async () => {
    const service = createService(
      new InMemoryFileSystemPort(),
      createPortHarness().ports,
      emptySource,
    );

    await expect(
      service.prepare('Fix build.', { schemaVersion: 9, kind: 'CORRECTION', apply: {} }),
    ).rejects.toMatchObject({ code: 'INVALID_ITERATION_FEEDBACK' });
  });

  it('does not make a preparation retryable when Apply throws before producing a FileApplyResult (P1-6)', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const service = createService(
      fileSystem,
      createPortHarness().ports,
      emptySource,
      new ContextBuilderService(),
      new ThrowingFileApplyEngineService(fileSystem),
    );

    const preparation = await service.prepare('Create the approved integration artifact.');

    await expect(service.approveAndApply(preparation.preparationId, true)).rejects.toThrow(
      'internal contract violation',
    );
    await expect(service.approveAndApply(preparation.preparationId, true)).rejects.toMatchObject({
      code: 'PREPARATION_NOT_FOUND',
    });
  });
});

function createService(
  fileSystem: InMemoryFileSystemPort,
  verificationPorts: ConstructorParameters<typeof VerificationEngineService>[0],
  sourceFiles: ProjectFileSource = emptySource,
  contextBuilder: ContextBuilderService = new ContextBuilderService(),
  fileApply: FileApplyEngineService = new FileApplyEngineService(fileSystem),
  artifactLogicalPath = 'src/integration-output.ts',
): WorkspaceRuntimeService {
  let providerTick = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () => ({
        id: 'response-integration',
        model: 'integration-model',
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'Created an integration artifact.',
          artifacts: [
            {
              logicalPath: artifactLogicalPath,
              type: 'SOURCE_FILE',
              content: 'export const integrated = true;\n',
              metadata: {
                description: 'Create the integration artifact',
                'change-operation': 'CREATE_FILE',
              },
            },
          ],
          diagnostics: [],
        }),
        error: null,
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }),
    },
    providerClock,
  );
  const timestamp = new Date('2026-07-31T13:00:00.000Z');
  return new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    sourceFiles,
    contextBuilder,
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution: new OpenAIExecutionService(provider, configuration, providerClock),
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply,
    verification: new VerificationEngineService(verificationPorts),
    clock: { now: () => new Date(timestamp) },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: { record: () => undefined },
  });
}
