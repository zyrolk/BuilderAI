import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService, type ProjectFileSource } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import { VerificationEngineService } from '../../core/verification';
import { InMemoryFileSystemPort } from '../../core/file-apply/test/file-apply.fixture';
import { createPortHarness } from '../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../infrastructure/project';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../providers/openai';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import { WorkspaceRuntimeService } from './workspace-runtime.service';

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

  override async build(
    ...parameters: Parameters<ContextBuilderService['build']>
  ): Promise<Awaited<ReturnType<ContextBuilderService['build']>>> {
    this.lastPackage = await super.build(...parameters);
    return this.lastPackage;
  }
}

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
    expect(contextBuilder.lastPackage?.size.characters).toBeLessThanOrEqual(50_000);
  });

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
    expect(contextBuilder.lastPackage?.size.characters).toBeLessThanOrEqual(50_000);
    expect(contextBuilder.lastPackage?.projectIdentity.id).toBe('builder-ai');
    expect(contextBuilder.lastPackage?.constraints).toEqual(
      loadCanonicalProjectBrain().blueprint.constraints,
    );
    expect(contextBuilder.lastPackage?.currentTask.description).toBe(request);
    expect(contextBuilder.lastPackage?.currentTask.acceptanceCriteria).not.toContain(request);
    expect(contextBuilder.lastPackage?.relevantDocumentation.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(['project-constitution', 'ai-rules']),
    );
  });
});

function createService(
  fileSystem: InMemoryFileSystemPort,
  verificationPorts: ConstructorParameters<typeof VerificationEngineService>[0],
  sourceFiles: ProjectFileSource = emptySource,
  contextBuilder: ContextBuilderService = new ContextBuilderService(),
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
    providerExecution: new OpenAIExecutionService(provider, configuration, providerClock),
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: new FileApplyEngineService(fileSystem),
    verification: new VerificationEngineService(verificationPorts),
    clock: { now: () => new Date(timestamp) },
    ids: { generate: () => '123e4567-e89b-12d3-a456-426614174000' },
    logger: { record: () => undefined },
  });
}
