import 'server-only';

import { randomUUID } from 'node:crypto';

import type { WorkspaceSecurityConfiguration } from '../../application/workspace/workspace-authorization.types';
import type { InvestigationService } from '../../application/workspace';
import {
  FeatureDecompositionService,
  FeaturePlanPersistence,
  FeatureWorkflowService,
  ActivityHistoryService,
  WorkspaceRuntimeService,
  ProjectMemoryService,
} from '../../application/workspace';
import {
  createDefaultInvestigationService,
  ProviderInvestigationAnalyzer,
} from '../../application/workspace/investigation';
import {
  createProjectContextReader,
  loadExternalTargetSourceIndexOptions,
  loadWorkspaceProjectBrain,
  readWorkspaceProjectId,
} from '../../core/target-project';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
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
import { createNodeVerificationRunners, NodeProjectValidator } from '../verification';
import { loadLocalWorkspaceRuntimeConfiguration } from './local-runtime-configuration';
import { StructuredRuntimeLogger } from './structured-runtime-logger';

type LocalWorkspaceServices = {
  readonly runtime: WorkspaceRuntimeService;
  readonly investigation: InvestigationService;
  readonly featureWorkflow: FeatureWorkflowService;
  readonly featureDecomposition: FeatureDecompositionService;
  readonly activityHistory: ActivityHistoryService;
  readonly projectMemory?: ProjectMemoryService;
  readonly security: WorkspaceSecurityConfiguration;
};

let singleton: LocalWorkspaceServices | undefined;

export function getLocalInvestigationService(): InvestigationService {
  return getLocalWorkspaceServices().investigation;
}

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

export function getLocalProjectMemory(): ProjectMemoryService | undefined {
  return getLocalWorkspaceServices().projectMemory;
}

export function getLocalWorkspaceSecurityConfiguration(): WorkspaceSecurityConfiguration {
  return getLocalWorkspaceServices().security;
}

function getLocalWorkspaceServices(): LocalWorkspaceServices {
  singleton ??= createLocalWorkspaceServices();
  return singleton;
}

function createLocalWorkspaceServices(): LocalWorkspaceServices {
  const configuration = loadLocalWorkspaceRuntimeConfiguration();
  const sourceIndexOptions = {
    extraScanRoots: configuration.extraSourceScanRoots,
    ...loadExternalTargetSourceIndexOptions(
      configuration.projectRoot,
      configuration.projectProfile,
    ),
  };
  const documentSource = new NodeFileSystemDocumentSource(configuration.projectRoot);
  const blueprintReader = createProjectContextReader({
    profile: configuration.projectProfile,
    projectRoot: configuration.projectRoot,
    source: documentSource,
  });
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
  const verificationRunners = createNodeVerificationRunners({
    projectRoot: configuration.projectRoot,
    commandTimeoutMs: configuration.verificationCommandTimeoutMs,
    maximumOutputBytes: configuration.verificationMaximumOutputBytes,
  });
  const projectValidator = new NodeProjectValidator(blueprintReader);
  const activityHistory = new ActivityHistoryService({ projectRoot: configuration.projectRoot });
  const projectMemory = createProjectMemoryService(
    configuration.projectRoot,
    configuration.projectProfile,
  );
  const workspaceBaseline = new NodeWorkspaceBaseline(configuration.projectRoot);
  const sourceFiles = new NodeProjectFileSource(configuration.projectRoot, sourceIndexOptions);
  const runtime = new WorkspaceRuntimeService({
    loadProjectBrain: () =>
      loadWorkspaceProjectBrain(configuration.projectRoot, configuration.projectProfile),
    blueprintReader,
    sourceFiles,
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline,
    providerExecution,
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(
      undefined,
      new NodeWorkspaceVisibility(configuration.projectRoot),
      workspaceBaseline,
    ),
    fileApply: new FileApplyEngineService(new NodeProjectFileSystem(configuration.projectRoot)),
    verification: new VerificationEngineService({
      projectValidator,
      dependencyValidator: verificationRunners.dependencyValidator,
      buildRunner: verificationRunners.buildRunner,
      testRunner: verificationRunners.testRunner,
      lintRunner: verificationRunners.lintRunner,
      typecheckRunner: verificationRunners.typecheckRunner,
    }),
    activityHistory,
    clock: { now: () => new Date() },
    ids: { generate: randomUUID },
    logger: runtimeLogger,
    configuration: configuration.workspace,
    security: configuration.security,
    projectRoot: configuration.projectRoot,
    projectMemory,
  });
  const investigation = createDefaultInvestigationService({
    sourceFiles,
    clock: { now: () => new Date() },
    ids: { generate: randomUUID },
    logger: runtimeLogger,
    providerTimeoutMs: configuration.workspace.providerTimeoutMs,
    analyzer: new ProviderInvestigationAnalyzer(providerExecution),
    projectMemory,
  });
  const persistence = new FeaturePlanPersistence(configuration.projectRoot);
  const featureWorkflow = new FeatureWorkflowService({
    runtime,
    persistence,
    loadProjectBrain: () =>
      loadWorkspaceProjectBrain(configuration.projectRoot, configuration.projectProfile),
    clock: { now: () => new Date() },
  });
  const featureDecomposition = new FeatureDecompositionService({
    loadProjectBrain: () =>
      loadWorkspaceProjectBrain(configuration.projectRoot, configuration.projectProfile),
    blueprintReader,
    sourceFiles: new NodeProjectFileSource(configuration.projectRoot, sourceIndexOptions),
    providerExecution,
    projectRoot: configuration.projectRoot,
    clock: { now: () => new Date() },
    ids: { generate: randomUUID },
  });
  return {
    runtime,
    investigation,
    featureWorkflow,
    featureDecomposition,
    activityHistory,
    projectMemory,
    security: configuration.security,
  };
}

function createProjectMemoryService(
  projectRoot: string,
  profile: ReturnType<typeof loadLocalWorkspaceRuntimeConfiguration>['projectProfile'],
): ProjectMemoryService | undefined {
  if (profile !== 'EXTERNAL_TARGET') return undefined;
  try {
    const projectId = readWorkspaceProjectId(projectRoot, profile);
    return new ProjectMemoryService({
      projectRoot,
      projectId,
      profile,
      clock: () => new Date(),
      ids: { generate: randomUUID },
    });
  } catch {
    return undefined;
  }
}
