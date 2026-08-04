import 'server-only';

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FeatureDecompositionService,
  FeaturePlanPersistence,
  FeatureWorkflowService,
  ActivityHistoryService,
  WorkspaceRuntimeService,
} from '../../application/workspace';
import { BlueprintReaderService } from '../../core/blueprint-reader';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { parseProjectBrain } from '../../core/project-brain';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import { VerificationEngineService } from '../../core/verification';
import { createGeminiProvider, GeminiExecutionService } from '../../providers/gemini';
import { createOpenAIProvider, OpenAIExecutionService } from '../../providers/openai';
import { createOpenRouterProvider, OpenRouterExecutionService } from '../../providers/openrouter';
import { NodeFileSystemDocumentSource } from '../blueprint-reader';
import { NodeProjectFileSystem } from '../file-system';
import { NodeWorkspaceBaseline } from './node-workspace-baseline';
import { NodeWorkspaceVisibility } from './node-workspace-visibility';
import { NodeProjectFileSource } from '../project';
import {
  BoundedNpmCommandRunner,
  NodeBuildRunner,
  NodeDependencyValidator,
  NodeProjectValidator,
  NodeTestRunner,
} from '../verification';
import { loadLocalWorkspaceRuntimeConfiguration } from './local-runtime-configuration';
import { StructuredRuntimeLogger } from './structured-runtime-logger';

type LocalWorkspaceServices = {
  readonly runtime: WorkspaceRuntimeService;
  readonly featureWorkflow: FeatureWorkflowService;
  readonly featureDecomposition: FeatureDecompositionService;
  readonly activityHistory: ActivityHistoryService;
};

let singleton: LocalWorkspaceServices | undefined;

export function getLocalWorkspaceRuntime(): WorkspaceRuntimeService {
  return getLocalWorkspaceServices().runtime;
}

export function getLocalFeatureWorkflow(): FeatureWorkflowService {
  return getLocalWorkspaceServices().featureWorkflow;
}

export function getLocalFeatureDecomposition(): FeatureDecompositionService {
  return getLocalWorkspaceServices().featureDecomposition;
}

export function getLocalActivityHistory(): ActivityHistoryService {
  return getLocalWorkspaceServices().activityHistory;
}

function getLocalWorkspaceServices(): LocalWorkspaceServices {
  singleton ??= createLocalWorkspaceServices();
  return singleton;
}

function createLocalWorkspaceServices(): LocalWorkspaceServices {
  const configuration = loadLocalWorkspaceRuntimeConfiguration();
  const documentSource = new NodeFileSystemDocumentSource(configuration.projectRoot);
  const blueprintReader = new BlueprintReaderService(documentSource);
  const runtimeLogger = new StructuredRuntimeLogger();
  const providerExecution =
    configuration.provider.kind === 'openai'
      ? new OpenAIExecutionService(
          createOpenAIProvider(configuration.provider.settings, {
            apiKey: configuration.provider.apiKey,
          }),
          configuration.provider.settings,
        )
      : configuration.provider.kind === 'gemini'
        ? new GeminiExecutionService(
            createGeminiProvider(configuration.provider.settings, {
              apiKey: configuration.provider.apiKey,
            }),
            configuration.provider.settings,
            undefined,
            {
              recordAttempt: (event) => {
                runtimeLogger.record({
                  correlationId: event.correlationId,
                  stage: 'PROVIDER_EXECUTION_ATTEMPT',
                  outcome: event.outcome,
                  durationMs: event.durationMs,
                  code: event.errorCode,
                  attempt: event.attempt,
                  boundingActive: event.boundingActive,
                  compactionActive: event.compactionActive,
                  allowlistCount: event.allowlistCount,
                  attemptTimeoutMs: event.attemptTimeoutMs,
                  finishReason: event.finishReason,
                  inputTokens: event.inputTokens,
                  outputTokens: event.outputTokens,
                  providerStatus: event.providerStatus,
                  providerErrorCategory: event.providerErrorCategory,
                  providerErrorCode: event.providerErrorCode,
                  sdkErrorName: event.sdkErrorName,
                  retryAfterMs: event.retryAfterMs,
                });
              },
            },
          )
        : new OpenRouterExecutionService(
            createOpenRouterProvider(configuration.provider.settings, {
              apiKey: configuration.provider.apiKey,
              baseUrl: configuration.provider.baseUrl,
              ...(configuration.provider.httpReferer === undefined
                ? {}
                : { httpReferer: configuration.provider.httpReferer }),
              ...(configuration.provider.appTitle === undefined
                ? {}
                : { appTitle: configuration.provider.appTitle }),
            }),
            configuration.provider.settings,
          );
  const commandRunner = new BoundedNpmCommandRunner({
    projectRoot: configuration.projectRoot,
    commandTimeoutMs: configuration.verificationCommandTimeoutMs,
    maximumOutputBytes: configuration.verificationMaximumOutputBytes,
  });
  const projectValidator = new NodeProjectValidator(blueprintReader);
  const activityHistory = new ActivityHistoryService({ projectRoot: configuration.projectRoot });
  const runtime = new WorkspaceRuntimeService({
    loadProjectBrain: () => loadProjectBrain(configuration.projectRoot),
    blueprintReader,
    sourceFiles: new NodeProjectFileSource(configuration.projectRoot, {
      extraScanRoots: configuration.extraSourceScanRoots,
    }),
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    providerExecution,
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(
      undefined,
      new NodeWorkspaceVisibility(configuration.projectRoot),
      new NodeWorkspaceBaseline(configuration.projectRoot),
    ),
    fileApply: new FileApplyEngineService(new NodeProjectFileSystem(configuration.projectRoot)),
    verification: new VerificationEngineService({
      projectValidator,
      dependencyValidator: new NodeDependencyValidator(commandRunner),
      buildRunner: new NodeBuildRunner(commandRunner),
      testRunner: new NodeTestRunner(commandRunner),
    }),
    activityHistory,
    clock: { now: () => new Date() },
    ids: { generate: randomUUID },
    logger: runtimeLogger,
    configuration: configuration.workspace,
  });
  const persistence = new FeaturePlanPersistence(configuration.projectRoot);
  const featureWorkflow = new FeatureWorkflowService({
    runtime,
    persistence,
    loadProjectBrain: () => loadProjectBrain(configuration.projectRoot),
    clock: { now: () => new Date() },
  });
  const featureDecomposition = new FeatureDecompositionService({
    loadProjectBrain: () => loadProjectBrain(configuration.projectRoot),
    blueprintReader,
    sourceFiles: new NodeProjectFileSource(configuration.projectRoot, {
      extraScanRoots: configuration.extraSourceScanRoots,
    }),
    providerExecution,
    projectRoot: configuration.projectRoot,
    clock: { now: () => new Date() },
    ids: { generate: randomUUID },
  });
  return { runtime, featureWorkflow, featureDecomposition, activityHistory };
}

function loadProjectBrain(projectRoot: string) {
  return parseProjectBrain(
    JSON.parse(readFileSync(path.join(projectRoot, 'project-brain.json'), 'utf8')) as unknown,
  );
}
