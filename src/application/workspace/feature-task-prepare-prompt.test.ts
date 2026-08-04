import { describe, expect, it, vi } from 'vitest';

import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService, type ContextBuildInput } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { InMemoryFileSystemPort } from '../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import {
  PromptOrchestratorService,
  PromptPackageValidator,
  type PromptBuildInput,
} from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import { VerificationEngineService } from '../../core/verification';
import { createPortHarness } from '../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import { NodeProjectFileSource } from '../../infrastructure/project';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../providers/openai';
import { FEATURE_SHADOW_TASK_ID_PREFIX, FEATURE_TASK_ID_PREFIX } from './bounded-project-task-id';
import { normalizeFeaturePlan } from './feature-plan.service';
import { buildIterationFeedbackFromCompletion } from './iteration-feedback.service';
import { NullWorkspaceBaselinePort } from '../../core/update-scope/test/workspace-baseline.fixture';
import { WorkspaceRuntimeService } from './workspace-runtime.service';

const NOW = '2026-07-31T13:00:00.000Z';

const configuration: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 30_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

class RecordingContextBuilder extends ContextBuilderService {
  lastInput?: ContextBuildInput;

  override async build(
    input: ContextBuildInput,
    ...parameters: Parameters<ContextBuilderService['build']> extends [
      ContextBuildInput,
      ...infer Rest,
    ]
      ? Rest
      : never
  ) {
    this.lastInput = input;
    return super.build(input, ...parameters);
  }
}

class RecordingPromptOrchestrator extends PromptOrchestratorService {
  lastBuildInput?: PromptBuildInput;
  lastPromptPackage?: Awaited<ReturnType<PromptOrchestratorService['build']>>;

  override async build(input: PromptBuildInput) {
    this.lastBuildInput = input;
    this.lastPromptPackage = await super.build(input);
    new PromptPackageValidator().validate(this.lastPromptPackage);
    return this.lastPromptPackage;
  }
}

function approvedFeaturePlan() {
  return normalizeFeaturePlan(
    {
      schemaVersion: 1,
      featurePlanId: '20943166-baf9-4936-bd3d-d269ff015d42',
      sourceRequest: 'Add activity history',
      title: 'Workspace Activity History Panel',
      summary: 'Summary',
      status: 'APPROVED',
      createdAt: NOW,
      updatedAt: NOW,
      tasks: [
        {
          taskId: 'task-001',
          title: 'Define Types',
          objective: 'Establish activity record types and schemas.',
          scope: 'src/application/workspace',
          dependencyIds: [],
          expectedAreas: ['src/application/workspace'],
          acceptanceCriteria: ['Types compile'],
          order: 1,
          status: 'READY',
        },
        {
          taskId: 'task-002',
          title: 'Service',
          objective: 'Implement history service.',
          scope: 'src/application/workspace',
          dependencyIds: ['task-001'],
          expectedAreas: ['src/application/workspace'],
          acceptanceCriteria: ['Service appends records'],
          order: 2,
          status: 'PENDING',
        },
      ],
    },
    { now: NOW },
  );
}

function createRuntime(options: {
  readonly promptOrchestrator: RecordingPromptOrchestrator;
  readonly contextBuilder: RecordingContextBuilder;
  readonly artifactLogicalPath?: string;
}) {
  const artifactLogicalPath =
    options.artifactLogicalPath ?? 'src/application/workspace/workspace-activity-history.types.ts';
  let providerTick = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () => ({
        id: 'response-feature-task',
        model: 'integration-model',
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'Created activity history types.',
          artifacts: [
            {
              logicalPath: artifactLogicalPath,
              type: 'SOURCE_FILE',
              content: 'export type WorkspaceActivityKind = "PREPARATION";\n',
              metadata: {
                description: 'Define activity history types',
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
  const providerExecution = new OpenAIExecutionService(provider, configuration, providerClock);
  const executeSpy = vi.spyOn(providerExecution, 'execute');

  const service = new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    sourceFiles: new NodeProjectFileSource(process.cwd()),
    contextBuilder: options.contextBuilder,
    promptOrchestrator: options.promptOrchestrator,
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution,
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
    verification: new VerificationEngineService(createPortHarness().ports),
    clock: { now: () => new Date(Date.parse(NOW)) },
    ids: { generate: () => 'feature-task-prepare-001' },
    logger: { record: () => undefined },
  });

  return { service, executeSpy };
}

describe('prepareFeatureTask prompt metadata contract', () => {
  it('uses kebab-case feature task metadata and passes PromptPackage validation', async () => {
    const plan = approvedFeaturePlan();
    const task = plan.tasks[0]!;
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const contextBuilder = new RecordingContextBuilder();
    const { service, executeSpy } = createRuntime({ promptOrchestrator, contextBuilder });

    const preparation = await service.prepareFeatureTask({
      request: task.objective,
      plan,
      task,
      dependencyOverrides: [],
    });

    const metadata = promptOrchestrator.lastBuildInput?.metadata ?? {};
    expect(metadata['feature-plan-id']).toBe(plan.featurePlanId);
    expect(metadata['task-id']).toBe(task.taskId);
    expect(metadata).not.toHaveProperty('featurePlanId');
    expect(metadata).not.toHaveProperty('taskId');
    expect(promptOrchestrator.lastPromptPackage).toBeDefined();
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(preparation.preparationId).toBe('feature-task-prepare-001');
    expect(preparation.changePlan.changeSet.operations.length).toBeGreaterThan(0);
  }, 30_000);

  it('passes expectedAreas as iteration path hints to context builder', async () => {
    const plan = approvedFeaturePlan();
    const task = plan.tasks[0]!;
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const contextBuilder = new RecordingContextBuilder();
    const { service } = createRuntime({ promptOrchestrator, contextBuilder });

    await service.prepareFeatureTask({
      request: task.objective,
      plan,
      task,
      dependencyOverrides: [],
    });

    expect(contextBuilder.lastInput?.iterationPathHints).toEqual(task.expectedAreas);
  }, 30_000);

  it('includes completed dependency shadow tasks in execution brain', async () => {
    const plan = normalizeFeaturePlan(
      {
        ...approvedFeaturePlan(),
        tasks: [
          {
            taskId: 'task-001',
            title: 'Schema',
            objective: 'Add schema',
            scope: 'src/application/workspace',
            dependencyIds: [],
            expectedAreas: ['src/application/workspace'],
            acceptanceCriteria: ['Done'],
            order: 1,
            status: 'COMPLETED',
            lastOutcome: { summary: 'Done', completedAt: NOW },
          },
          {
            taskId: 'task-002',
            title: 'Service',
            objective: 'Implement service',
            scope: 'src/application/workspace',
            dependencyIds: ['task-001'],
            expectedAreas: ['src/application/workspace'],
            acceptanceCriteria: ['Service works'],
            order: 2,
            status: 'READY',
          },
        ],
      },
      { now: NOW },
    );
    const task = plan.tasks.find(({ taskId }) => taskId === 'task-002')!;
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const contextBuilder = new RecordingContextBuilder();
    const { service } = createRuntime({ promptOrchestrator, contextBuilder });

    await service.prepareFeatureTask({
      request: task.objective,
      plan,
      task,
      dependencyOverrides: [],
    });

    const brain = contextBuilder.lastInput?.projectBrain;
    expect(brain?.tasks.some(({ id }) => id.startsWith(`${FEATURE_SHADOW_TASK_ID_PREFIX}-`))).toBe(
      true,
    );
  }, 30_000);

  it('merges iteration feedback path hints for feature-bound correction', async () => {
    const plan = approvedFeaturePlan();
    const task = { ...plan.tasks[0]!, status: 'IN_PROGRESS' as const };
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const contextBuilder = new RecordingContextBuilder();
    const { service } = createRuntime({
      promptOrchestrator,
      contextBuilder,
      artifactLogicalPath: 'src/application/workspace/workspace-runtime.service.ts',
    });
    const feedback = buildIterationFeedbackFromCompletion({
      applyResult: {
        schemaVersion: 1,
        status: 'APPLIED',
        createdFiles: [],
        updatedFiles: ['src/application/workspace/workspace-runtime.service.ts'],
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
        errors: [{ code: 'TEST_FAILED', message: 'Failed.', stage: 'TEST_VALIDATION' }],
        durationMs: 1,
        metadata: {},
      },
    });

    await service.prepareFeatureTask({
      request: 'Fix verification failures.',
      plan: { ...plan, tasks: [task, ...plan.tasks.slice(1)] },
      task,
      dependencyOverrides: [],
      iterationFeedback: feedback,
    });

    expect(contextBuilder.lastInput?.iterationPathHints?.length).toBeGreaterThan(0);
    expect(promptOrchestrator.lastBuildInput?.iterationFeedback).toBeDefined();
  }, 30_000);

  it('leaves ordinary workspace prepare metadata unchanged', async () => {
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const contextBuilder = new RecordingContextBuilder();
    const { service } = createRuntime({ promptOrchestrator, contextBuilder });

    await service.prepare('Ordinary workspace request');

    expect(promptOrchestrator.lastBuildInput?.metadata).toEqual({
      'correlation-id': 'feature-task-prepare-001',
      source: 'workspace',
    });
    expect(promptOrchestrator.lastBuildInput?.metadata).not.toHaveProperty('feature-plan-id');
    expect(promptOrchestrator.lastBuildInput?.metadata).not.toHaveProperty('task-id');
  }, 30_000);

  it('reaches Prompt Orchestrator when the fresh-pilot descriptive FeatureTask ID is used', async () => {
    const plan = normalizeFeaturePlan(
      {
        schemaVersion: 1,
        featurePlanId: '16a0c3ac-232b-41a2-98fe-4ad6fafd27f5',
        sourceRequest: 'Add activity history',
        title: 'Workspace Activity History Panel',
        summary: 'Summary',
        status: 'APPROVED',
        createdAt: NOW,
        updatedAt: NOW,
        tasks: [
          {
            taskId: 'task-1-history-types-and-schema',
            title: 'Define Activity History Types and Schema',
            objective: 'Establish data contracts and validation schemas.',
            scope: 'src/application/workspace',
            expectedAreas: ['src/application/workspace'],
            order: 1,
            status: 'READY',
          },
        ],
      },
      { now: NOW },
    );
    const task = plan.tasks[0]!;
    const promptOrchestrator = new RecordingPromptOrchestrator();
    const contextBuilder = new RecordingContextBuilder();
    const { service, executeSpy } = createRuntime({ promptOrchestrator, contextBuilder });

    await service.prepareFeatureTask({
      request: task.objective,
      plan,
      task,
      dependencyOverrides: [],
    });

    expect(promptOrchestrator.lastPromptPackage).toBeDefined();
    expect(contextBuilder.lastInput?.currentTaskId.startsWith(`${FEATURE_TASK_ID_PREFIX}-`)).toBe(
      true,
    );
    expect(executeSpy).toHaveBeenCalledOnce();
  }, 30_000);
});
