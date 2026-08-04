import { describe, expect, it, vi } from 'vitest';

import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService, type ProjectFileSource } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { InMemoryFileSystemPort } from '../../core/file-apply/test/file-apply.fixture';
import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import {
  VerificationEngineService,
  type VerificationStagePortResult,
} from '../../core/verification';
import { createPortHarness } from '../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../infrastructure/blueprint-reader';
import type { ActivityHistoryService } from './activity-history.service';
import { parseWorkspaceActivity } from './activity-history.schemas';
import type { WorkspaceActivity } from './activity-history.types';
import { normalizeFeaturePlan } from './feature-plan.service';
import { NullWorkspaceBaselinePort } from '../../core/update-scope/test/workspace-baseline.fixture';
import { WorkspaceRuntimeService } from './workspace-runtime.service';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../providers/openai';

const NOW = '2026-08-03T12:00:00.000Z';
const FEATURE_PLAN_ID = '16a0c3ac-232b-41a2-98fe-4ad6fafd27f5';
const TASK_ID = 'task-3-workspace-orchestration-integration';

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

class RecordingActivityHistoryService {
  readonly activities: WorkspaceActivity[] = [];
  readonly recordActivity = vi.fn(async (activity: WorkspaceActivity) => {
    parseWorkspaceActivity(activity);
    this.activities.push(structuredClone(activity));
    return { schemaVersion: 1 as const, activities: this.activities };
  });
}

function approvedFeaturePlan() {
  return normalizeFeaturePlan(
    {
      schemaVersion: 1,
      featurePlanId: FEATURE_PLAN_ID,
      sourceRequest: 'Add activity history orchestration hooks.',
      title: 'Workspace Activity History Panel',
      summary: 'Summary',
      status: 'APPROVED',
      createdAt: NOW,
      updatedAt: NOW,
      tasks: [
        {
          taskId: 'task-1-history-types-and-schema',
          title: 'Types',
          objective: 'Types',
          scope: 'src/application/workspace',
          dependencyIds: [],
          expectedAreas: ['src/application/workspace'],
          acceptanceCriteria: ['Types compile'],
          order: 1,
          status: 'COMPLETED',
        },
        {
          taskId: 'task-2-history-recorder-service',
          title: 'Service',
          objective: 'Service',
          scope: 'src/application/workspace',
          dependencyIds: ['task-1-history-types-and-schema'],
          expectedAreas: ['src/application/workspace'],
          acceptanceCriteria: ['Service appends records'],
          order: 2,
          status: 'COMPLETED',
        },
        {
          taskId: TASK_ID,
          title: 'Integrate History Recorder into Workspace Orchestration',
          objective: 'Hook the history recorder into the workspace execution lifecycle.',
          scope: 'src/application/workspace',
          dependencyIds: ['task-2-history-recorder-service'],
          expectedAreas: ['src/application/workspace'],
          acceptanceCriteria: [
            'Completed preparations trigger a history record with affected logical paths.',
            'Apply outcomes trigger a history record.',
            'Verification status updates trigger a history record.',
          ],
          order: 3,
          status: 'READY',
        },
      ],
    },
    { now: NOW },
  );
}

function createProvider(artifactLogicalPath: string) {
  let providerTick = 0;
  const providerClock = (): string => new Date(Date.parse(NOW) + providerTick++ * 10).toISOString();
  const provider = new OpenAIProvider(
    configuration,
    {
      create: async () => ({
        id: 'response-orchestration',
        model: 'integration-model',
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'Wire activity history into workspace orchestration.',
          artifacts: [
            {
              logicalPath: artifactLogicalPath,
              type: 'SOURCE_FILE',
              content: 'export const orchestrated = true;\n',
              metadata: {
                description: 'Orchestration hook',
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
  return {
    providerExecution: new OpenAIExecutionService(provider, configuration, providerClock),
    providerClock,
  };
}

function createRuntime(options: {
  readonly fileSystem: InMemoryFileSystemPort;
  readonly activityHistory: RecordingActivityHistoryService;
  readonly verificationPorts?: ConstructorParameters<typeof VerificationEngineService>[0];
  readonly fileApply?: FileApplyEngineService;
  readonly artifactLogicalPath?: string;
}) {
  const artifactLogicalPath = options.artifactLogicalPath ?? 'src/integration-output.ts';
  const { providerExecution } = createProvider(artifactLogicalPath);
  const timestamp = new Date(NOW);
  let idCounter = 0;
  return new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    sourceFiles: emptySource,
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution,
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: options.fileApply ?? new FileApplyEngineService(options.fileSystem),
    verification: new VerificationEngineService(
      options.verificationPorts ?? createPortHarness().ports,
    ),
    activityHistory: options.activityHistory as unknown as ActivityHistoryService,
    clock: { now: () => new Date(timestamp) },
    ids: { generate: () => `activity-id-${++idCounter}` },
    logger: { record: () => undefined },
  });
}

describe('Workspace activity history orchestration integration', () => {
  it('records preparation, apply, and verification activities for feature-bound prepares', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const activityHistory = new RecordingActivityHistoryService();
    const service = createRuntime({ fileSystem, activityHistory });
    const plan = approvedFeaturePlan();
    const task = plan.tasks.find(({ taskId }) => taskId === TASK_ID)!;

    const preparation = await service.prepareFeatureTask({
      request: 'Hook history recording into workspace orchestration.',
      plan,
      task,
      dependencyOverrides: [],
    });

    const preparationTypes = activityHistory.activities.map(({ type }) => type);
    expect(preparationTypes).toContain('TASK_PREPARATION_STARTED');
    expect(preparationTypes).toContain('TASK_PREPARATION_COMPLETED');

    const completed = activityHistory.activities.find(
      (activity) => activity.type === 'TASK_PREPARATION_COMPLETED',
    );
    expect(completed).toMatchObject({
      featurePlanId: FEATURE_PLAN_ID,
      taskId: TASK_ID,
      correlationId: preparation.preparationId,
    });
    if (completed?.type !== 'TASK_PREPARATION_COMPLETED') throw new Error('expected completed');
    expect(completed.payload.changePlanSummary.affectedPaths).toEqual([
      'src/integration-output.ts',
    ]);
    expect(JSON.stringify(completed.payload)).not.toMatch(/filecontent|stdout|stderr|apikey/i);

    await service.approveAndApply(preparation.preparationId, true);

    const applyTypes = activityHistory.activities.map(({ type }) => type);
    expect(applyTypes).toEqual(
      expect.arrayContaining([
        'FILE_APPLICATION_STARTED',
        'FILE_APPLICATION_COMPLETED',
        'VERIFICATION_STARTED',
        'VERIFICATION_COMPLETED',
      ]),
    );

    for (const activity of activityHistory.activities) {
      expect(activity.featurePlanId).toBe(FEATURE_PLAN_ID);
      expect(activity.taskId).toBe(TASK_ID);
      expect(activity.correlationId).toBe(preparation.preparationId);
      expect(JSON.stringify(activity.payload)).not.toMatch(/filecontent|stdout|stderr|apikey/i);
    }

    const applyCompleted = activityHistory.activities.find(
      (activity) => activity.type === 'FILE_APPLICATION_COMPLETED',
    );
    if (applyCompleted?.type !== 'FILE_APPLICATION_COMPLETED') throw new Error('expected apply');
    expect(applyCompleted.payload.createdFiles).toEqual(['src/integration-output.ts']);

    const verificationCompleted = activityHistory.activities.find(
      (activity) => activity.type === 'VERIFICATION_COMPLETED',
    );
    if (verificationCompleted?.type !== 'VERIFICATION_COMPLETED') {
      throw new Error('expected verification completed');
    }
    expect(verificationCompleted.payload.status).toBe('PASSED');
  }, 30_000);

  it('records failed apply outcomes for feature-bound preparations', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/integration-output.ts': 'already exists\n',
    });
    const activityHistory = new RecordingActivityHistoryService();
    const service = createRuntime({ fileSystem, activityHistory });
    const plan = approvedFeaturePlan();
    const task = plan.tasks.find(({ taskId }) => taskId === TASK_ID)!;

    const preparation = await service.prepareFeatureTask({
      request: 'Hook history recording into workspace orchestration.',
      plan,
      task,
      dependencyOverrides: [],
    });

    await service.approveAndApply(preparation.preparationId, true);

    const failed = activityHistory.activities.find(
      (activity) => activity.type === 'FILE_APPLICATION_FAILED',
    );
    expect(failed).toMatchObject({
      featurePlanId: FEATURE_PLAN_ID,
      taskId: TASK_ID,
      type: 'FILE_APPLICATION_FAILED',
    });
    if (failed?.type !== 'FILE_APPLICATION_FAILED') throw new Error('expected failed apply');
    expect(failed.payload.status).toBe('REJECTED');
  }, 30_000);

  it('does not fabricate feature identity for ordinary prepares', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const activityHistory = new RecordingActivityHistoryService();
    const service = createRuntime({ fileSystem, activityHistory });

    await service.prepare('Create the approved integration artifact.');
    expect(activityHistory.activities).toEqual([]);

    const preparation = await service.prepare('Create another artifact.');
    await service.approveAndApply(preparation.preparationId, true);
    expect(activityHistory.activities).toEqual([]);
  }, 30_000);

  it('records preparation failure without altering provider error classification', async () => {
    const activityHistory = new RecordingActivityHistoryService();
    let providerTick = 0;
    const providerClock = (): string =>
      new Date(Date.parse(NOW) + providerTick++ * 10).toISOString();
    const provider = new OpenAIProvider(
      configuration,
      {
        create: async () => {
          throw new Error('temporary network failure');
        },
      },
      providerClock,
    );
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
      fileApply: new FileApplyEngineService(new InMemoryFileSystemPort()),
      verification: new VerificationEngineService(createPortHarness().ports),
      activityHistory: activityHistory as unknown as ActivityHistoryService,
      clock: { now: () => new Date(NOW) },
      ids: { generate: () => 'prep-failure-id' },
      logger: { record: () => undefined },
    });
    const plan = approvedFeaturePlan();
    const task = plan.tasks.find(({ taskId }) => taskId === TASK_ID)!;

    await expect(
      service.prepareFeatureTask({
        request: 'Hook history recording into workspace orchestration.',
        plan,
        task,
        dependencyOverrides: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });

    const failed = activityHistory.activities.find(
      (activity) => activity.type === 'TASK_PREPARATION_FAILED',
    );
    expect(failed).toMatchObject({
      featurePlanId: FEATURE_PLAN_ID,
      taskId: TASK_ID,
      type: 'TASK_PREPARATION_FAILED',
    });
    if (failed?.type !== 'TASK_PREPARATION_FAILED') throw new Error('expected prep failed');
    expect(failed.payload.errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(failed.payload.errorMessage).toContain('unavailable');
  }, 30_000);

  it('preserves primary workspace operation when recorder persistence fails', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const activityHistory = new RecordingActivityHistoryService();
    activityHistory.recordActivity.mockRejectedValueOnce(new Error('disk unavailable'));
    const logger = { record: vi.fn() };
    const { providerExecution } = createProvider('src/integration-output.ts');
    const service = new WorkspaceRuntimeService({
      loadProjectBrain: loadCanonicalProjectBrain,
      blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
      sourceFiles: emptySource,
      contextBuilder: new ContextBuilderService(),
      promptOrchestrator: new PromptOrchestratorService(),
      workspaceBaseline: new NullWorkspaceBaselinePort(),
      providerExecution,
      responseProcessor: new ResponseProcessorService(),
      changePlanner: new ChangePlannerService(),
      fileApply: new FileApplyEngineService(fileSystem),
      verification: new VerificationEngineService(createPortHarness().ports),
      activityHistory: activityHistory as unknown as ActivityHistoryService,
      clock: { now: () => new Date(NOW) },
      ids: { generate: () => 'recorder-failure-id' },
      logger,
    });
    const plan = approvedFeaturePlan();
    const task = plan.tasks.find(({ taskId }) => taskId === TASK_ID)!;

    const preparation = await service.prepareFeatureTask({
      request: 'Hook history recording into workspace orchestration.',
      plan,
      task,
      dependencyOverrides: [],
    });

    expect(preparation.changePlan.changeSet.operations).toHaveLength(1);
    expect(logger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'ACTIVITY_HISTORY_RECORD',
        outcome: 'FAILED',
      }),
    );
  }, 30_000);

  it('records verification failure without converting apply success into failure', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const activityHistory = new RecordingActivityHistoryService();
    const FAILED_STAGE: VerificationStagePortResult = {
      status: 'FAILED',
      warnings: [],
      errors: [{ code: 'STAGE_FAILED', message: 'Simulated stage failure.' }],
      metadata: {},
    };
    const service = createRuntime({
      fileSystem,
      activityHistory,
      verificationPorts: createPortHarness({
        PROJECT_VALIDATION: FAILED_STAGE,
        DEPENDENCY_VALIDATION: FAILED_STAGE,
        BUILD_VALIDATION: FAILED_STAGE,
        TEST_VALIDATION: FAILED_STAGE,
      }).ports,
    });
    const plan = approvedFeaturePlan();
    const task = plan.tasks.find(({ taskId }) => taskId === TASK_ID)!;

    const preparation = await service.prepareFeatureTask({
      request: 'Hook history recording into workspace orchestration.',
      plan,
      task,
      dependencyOverrides: [],
    });
    const completion = await service.approveAndApply(preparation.preparationId, true);

    expect(completion.applyResult.status).toBe('APPLIED');
    expect(completion.verificationReport?.status).toBe('FAILED');
    expect(
      activityHistory.activities.some(({ type }) => type === 'FILE_APPLICATION_COMPLETED'),
    ).toBe(true);
    expect(activityHistory.activities.some(({ type }) => type === 'VERIFICATION_COMPLETED')).toBe(
      true,
    );
    const verificationCompleted = activityHistory.activities.find(
      (activity) => activity.type === 'VERIFICATION_COMPLETED',
    );
    if (verificationCompleted?.type !== 'VERIFICATION_COMPLETED') {
      throw new Error('expected verification completed');
    }
    expect(verificationCompleted.payload.status).toBe('FAILED');
  }, 30_000);
});
