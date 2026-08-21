import 'server-only';

import { randomUUID } from 'node:crypto';

import path from 'node:path';

import { CorrectionLoopService } from '../../application/workspace/correction-loop';
import { ExternalTargetReadinessService } from '../../application/workspace/external-target-readiness';
import type { ExternalTargetReadiness } from '../../application/workspace/external-target-readiness/external-target-readiness.types';
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
import { InMemoryInvestigationHandoffStore } from '../../application/workspace/investigation';
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
import { loadWorkspacePathProtectionPolicy } from '../../core/target-project/workspace-path-protection.loader';
import { ChangePlannerService } from '../../core/change-planner';
import { ContextBuilderService } from '../../core/context-builder';
import { FileApplyEngineService } from '../../core/file-apply';
import { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../core/response-processor';
import { VerificationEngineService } from '../../core/verification';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../../core/verification';
import {
  CoordinatorProviderExecutionService,
  type CoordinatorProviderRoute,
} from '../../core/ai-provider/services/coordinator-provider-execution.service';
import { DEFAULT_PROVIDER_RETRY_CONFIGURATION } from '../../core/ai-provider/services/provider-retry-policy';
import { createGeminiProvider } from '../../providers/gemini';
import { createGeminiCoordinatorRoute } from '../../providers/gemini/services/gemini-execution.service';
import { createOpenAIProvider } from '../../providers/openai';
import { createOpenAICoordinatorRoute } from '../../providers/openai/services/openai-execution.service';
import { createOpenRouterProvider } from '../../providers/openrouter';
import { createOpenRouterCoordinatorRoute } from '../../providers/openrouter/services/openrouter-execution.service';
import { NodeFileSystemDocumentSource } from '../blueprint-reader';
import { NodeProjectFileSystem } from '../file-system';
import { NodeWorkspaceBaseline } from './node-workspace-baseline';
import { NodeWorkspaceVisibility } from './node-workspace-visibility';
import { NodeProjectFileSource } from '../project';
import { createNodeVerificationRunners, NodeProjectValidator } from '../verification';
import { createRuntimeBrowserVerificationService } from '../runtime-verification';
import { loadLocalWorkspaceRuntimeConfiguration } from './local-runtime-configuration';
import { StructuredRuntimeLogger } from './structured-runtime-logger';
import type { WorkspacePathProtectionPolicy } from '../../core/target-project/workspace-path-protection';
import {
  FilesystemWorkflowLedgerStore,
  NodeRepositoryBaselineService,
  StartupRecoveryInspector,
  DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION,
} from '../workflow-ledger';
import { DurableApplyCheckpointStore } from '../workflow-ledger/durable-apply-checkpoint.store';
import { RecoverableFileApplyCheckpoint } from '../workflow-ledger/recoverable-file-apply-checkpoint';
import {
  WorkflowLedgerOrchestrationService,
  CorrectionSessionPersistence,
} from '../../application/workspace/workflow-ledger';
import {
  AgentOperatingService,
  AgentRunPersistence,
  AgentRunService,
  ExplainArtifactPersistence,
} from '../../application/workspace/agent-operating';

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
let correctionLoopSingleton: CorrectionLoopService | undefined;
let agentOperatingSingleton: AgentOperatingService | undefined;

export function getLocalCorrectionLoopService(): CorrectionLoopService {
  getLocalWorkspaceServices();
  correctionLoopSingleton ??= createCorrectionLoopService();
  return correctionLoopSingleton;
}

/** Await hydration before serving correction routes. Never auto-continues APPLY. */
export async function getReadyLocalCorrectionLoopService(): Promise<CorrectionLoopService> {
  const service = getLocalCorrectionLoopService();
  await service.whenReady();
  return service;
}

export function getLocalAgentOperatingService(): AgentOperatingService {
  const services = getLocalWorkspaceServices();
  agentOperatingSingleton ??= createAgentOperatingService(services);
  return agentOperatingSingleton;
}

/** Await AgentRun + correction hydration. Never auto-approves or auto-applies. */
export async function getReadyLocalAgentOperatingService(): Promise<AgentOperatingService> {
  const service = getLocalAgentOperatingService();
  await service.whenReady();
  return service;
}

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

export async function getLocalExternalTargetReadiness(): Promise<
  ExternalTargetReadiness | undefined
> {
  const configuration = loadLocalWorkspaceRuntimeConfiguration();
  if (configuration.projectProfile !== 'EXTERNAL_TARGET') return undefined;
  return new ExternalTargetReadinessService().project({
    projectRoot: configuration.projectRoot,
    extraSourceScanRoots: configuration.extraSourceScanRoots,
    runtimeConnected: true,
  });
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
  const pathProtection = loadWorkspacePathProtectionPolicy(
    configuration.projectRoot,
    configuration.projectProfile,
  );
  const documentSource = new NodeFileSystemDocumentSource(configuration.projectRoot);
  const blueprintReader = createProjectContextReader({
    profile: configuration.projectProfile,
    projectRoot: configuration.projectRoot,
    source: documentSource,
  });
  const runtimeLogger = new StructuredRuntimeLogger();
  const runtimeClock = { now: () => new Date() };
  const runtimeIds = { generate: randomUUID };
  const investigationHandoffStore = new InMemoryInvestigationHandoffStore(runtimeClock);
  const providerExecution = createProductionProviderExecution(configuration, runtimeLogger);
  const verificationRunners = createNodeVerificationRunners({
    projectRoot: configuration.projectRoot,
    builderAiRoot: path.resolve(process.cwd()),
    commandTimeoutMs: configuration.verificationCommandTimeoutMs,
    maximumOutputBytes: configuration.verificationMaximumOutputBytes,
  });
  const projectValidator = new NodeProjectValidator(blueprintReader);
  const activityHistory = new ActivityHistoryService({ projectRoot: configuration.projectRoot });
  const projectMemory = createProjectMemoryService(
    configuration.projectRoot,
    configuration.projectProfile,
    pathProtection,
  );
  const workspaceBaseline = new NodeWorkspaceBaseline(configuration.projectRoot);
  const sourceFiles = new NodeProjectFileSource(configuration.projectRoot, sourceIndexOptions);
  const evaluateExternalTargetReadiness = () => getLocalExternalTargetReadiness();
  const workflowLedgerStore = new FilesystemWorkflowLedgerStore(
    DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION,
  );
  const workflowLedger = new WorkflowLedgerOrchestrationService(
    workflowLedgerStore,
    new NodeRepositoryBaselineService(),
    runtimeClock,
    runtimeIds,
  );
  void new StartupRecoveryInspector(workflowLedgerStore)
    .inspectProject(
      readWorkspaceProjectId(configuration.projectRoot, configuration.projectProfile),
      runtimeClock.now(),
    )
    .then((inspections) => {
      for (const inspection of inspections) {
        if (inspection.classification === 'RECOVERY_REQUIRED') {
          runtimeLogger.record({
            correlationId: inspection.workflowId,
            stage: 'WORKFLOW_RECOVERY_REQUIRED',
            outcome: 'FAILED',
            durationMs: 0,
            code: inspection.classification,
          });
        }
      }
    })
    .catch(() => undefined);
  const runtimeBrowserVerification = configuration.runtimeBrowserVerificationEnabled
    ? createRuntimeBrowserVerificationService({
        workflowDeadlineMs: configuration.runtimeBrowserWorkflowDeadlineMs,
        outputLimitBytes: configuration.runtimeBrowserMaximumOutputBytes,
      })
    : undefined;
  const durableApplyCheckpoint = new DurableApplyCheckpointStore(
    DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION.stateRoot,
    readWorkspaceProjectId(configuration.projectRoot, configuration.projectProfile),
  );
  const fileApplyCheckpoint = new RecoverableFileApplyCheckpoint(durableApplyCheckpoint);
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
    fileApply: new FileApplyEngineService(
      new NodeProjectFileSystem(configuration.projectRoot),
      pathProtection.toFileApplyConfiguration(),
      undefined,
      fileApplyCheckpoint,
    ),
    fileApplyCheckpoint,
    verification: new VerificationEngineService(
      {
        projectValidator,
        dependencyValidator: verificationRunners.dependencyValidator,
        buildRunner: verificationRunners.buildRunner,
        testRunner: verificationRunners.testRunner,
        lintRunner: verificationRunners.lintRunner,
        typecheckRunner: verificationRunners.typecheckRunner,
        formatRunner: verificationRunners.formatRunner,
      },
      {
        ...DEFAULT_VERIFICATION_CONFIGURATION,
        workflowDeadlineMs: configuration.verificationWorkflowDeadlineMs,
        stageTimeoutMs: configuration.verificationCommandTimeoutMs,
      },
    ),
    ...(runtimeBrowserVerification === undefined
      ? {}
      : { runtimeBrowserVerification, builderAiRoot: path.resolve(process.cwd()) }),
    activityHistory,
    clock: runtimeClock,
    ids: runtimeIds,
    logger: runtimeLogger,
    configuration: configuration.workspace,
    security: configuration.security,
    projectRoot: configuration.projectRoot,
    projectMemory,
    pathProtection,
    projectProfile: configuration.projectProfile,
    evaluateExternalTargetReadiness,
    workflowLedger,
    projectId: readWorkspaceProjectId(configuration.projectRoot, configuration.projectProfile),
  });
  const investigation = createDefaultInvestigationService({
    sourceFiles,
    clock: runtimeClock,
    ids: runtimeIds,
    logger: runtimeLogger,
    providerTimeoutMs: configuration.workspace.providerTimeoutMs,
    analyzer: new ProviderInvestigationAnalyzer(providerExecution),
    projectMemory,
    pathProtection,
    projectProfile: configuration.projectProfile,
    evaluateExternalTargetReadiness,
    handoffStore: investigationHandoffStore,
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

function createProductionProviderExecution(
  configuration: ReturnType<typeof loadLocalWorkspaceRuntimeConfiguration>,
  runtimeLogger: StructuredRuntimeLogger,
): CoordinatorProviderExecutionService {
  return new CoordinatorProviderExecutionService(
    {
      routes: buildProductionProviderRoutes(configuration),
      retry: {
        ...DEFAULT_PROVIDER_RETRY_CONFIGURATION,
        stageDeadlineMs: configuration.workspace.providerTimeoutMs,
      },
    },
    () => new Date().toISOString(),
    {
      recordAttempt: (diagnostics) => {
        runtimeLogger.record({
          correlationId: diagnostics.providerId,
          stage: 'PROVIDER_COORDINATOR_ATTEMPT',
          outcome: diagnostics.terminalState === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
          durationMs: diagnostics.elapsedMs,
          code: diagnostics.errorCode,
          attempt: diagnostics.attempt,
          retryAfterMs: diagnostics.retryAfterMs,
        });
      },
    },
  );
}

function buildProductionProviderRoutes(
  configuration: ReturnType<typeof loadLocalWorkspaceRuntimeConfiguration>,
): readonly CoordinatorProviderRoute[] {
  if (configuration.provider.kind === 'openai') {
    return [
      createOpenAICoordinatorRoute(
        createOpenAIProvider(configuration.provider.settings, {
          apiKey: configuration.provider.apiKey,
        }),
        configuration.provider.settings,
      ),
    ];
  }
  if (configuration.provider.kind === 'gemini') {
    return [
      createGeminiCoordinatorRoute(
        createGeminiProvider(configuration.provider.settings, {
          apiKey: configuration.provider.apiKey,
        }),
        configuration.provider.settings,
      ),
    ];
  }
  return [
    createOpenRouterCoordinatorRoute(
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
    ),
  ];
}

function createCorrectionLoopService(): CorrectionLoopService {
  const configuration = loadLocalWorkspaceRuntimeConfiguration();
  const projectId = readWorkspaceProjectId(configuration.projectRoot, configuration.projectProfile);
  const persistence = new CorrectionSessionPersistence(
    DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION.stateRoot,
    projectId,
  );
  const service = new CorrectionLoopService(
    {
      maximumCorrectionAttempts: configuration.correctionMaximumAttempts,
      hardMaximumCorrectionAttempts: configuration.correctionHardMaximumAttempts,
      workflowDeadlineMs: configuration.correctionWorkflowDeadlineMs,
    },
    () => new Date(),
    persistence,
  );
  // Start hydration immediately; callers must await whenReady()/getReadyLocalCorrectionLoopService.
  void service.hydratePersistedSessions();
  return service;
}

function createAgentOperatingService(services: LocalWorkspaceServices): AgentOperatingService {
  const configuration = loadLocalWorkspaceRuntimeConfiguration();
  const projectId = readWorkspaceProjectId(configuration.projectRoot, configuration.projectProfile);
  const persistence = new AgentRunPersistence(
    DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION.stateRoot,
    projectId,
  );
  const explainArtifacts = new ExplainArtifactPersistence(
    DEFAULT_WORKFLOW_STATE_ROOT_CONFIGURATION.stateRoot,
    projectId,
  );
  const agentRuns = new AgentRunService(persistence, () => new Date());
  void agentRuns.hydratePersistedRuns();
  return new AgentOperatingService({
    projectId,
    agentRuns,
    explainArtifacts,
    investigation: services.investigation,
    runtime: services.runtime,
    correction: getLocalCorrectionLoopService(),
    ids: { generate: randomUUID },
    clock: { now: () => new Date() },
  });
}

function createProjectMemoryService(
  projectRoot: string,
  profile: ReturnType<typeof loadLocalWorkspaceRuntimeConfiguration>['projectProfile'],
  pathProtection: WorkspacePathProtectionPolicy,
): ProjectMemoryService | undefined {
  if (profile !== 'EXTERNAL_TARGET') return undefined;
  try {
    const projectId = readWorkspaceProjectId(projectRoot, profile);
    return new ProjectMemoryService({
      projectRoot,
      projectId,
      profile,
      pathProtection,
      clock: () => new Date(),
      ids: { generate: randomUUID },
    });
  } catch {
    return undefined;
  }
}
