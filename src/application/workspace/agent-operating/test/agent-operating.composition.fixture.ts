import { FileApplyEngineService } from '../../../../core/file-apply';
import { InMemoryFileSystemPort } from '../../../../core/file-apply/test/file-apply.fixture';
import { BlueprintReaderService } from '../../../../core/blueprint-reader';
import { ChangePlannerService } from '../../../../core/change-planner';
import { ContextBuilderService } from '../../../../core/context-builder';
import { loadCanonicalProjectBrain } from '../../../../core/project-brain';
import { PromptOrchestratorService } from '../../../../core/prompt-orchestrator';
import { ResponseProcessorService } from '../../../../core/response-processor';
import { VerificationEngineService } from '../../../../core/verification';
import type { VerificationStagePortResult } from '../../../../core/verification';
import { createPortHarness } from '../../../../core/verification/test/verification.fixture';
import { NodeFileSystemDocumentSource } from '../../../../infrastructure/blueprint-reader';
import { NullWorkspaceBaselinePort } from '../../../../core/update-scope/test/workspace-baseline.fixture';
import {
  OpenAIExecutionService,
  OpenAIProvider,
  type OpenAIProviderConfiguration,
} from '../../../../providers/openai';
import { CorrectionLoopService } from '../../correction-loop';
import { WorkspaceRuntimeService } from '../../workspace-runtime.service';
import { AgentOperatingService } from '../agent-operating.service';
import { AgentRunPersistence } from '../agent-run.persistence';
import { AgentRunService } from '../agent-run.service';
import { ExplainArtifactPersistence } from '../explain-artifact.persistence';
import type { AgentOperatingInvestigationPort } from '../agent-operating.types';

const PROVIDER_CONFIGURATION: OpenAIProviderConfiguration = {
  model: 'integration-model',
  defaultTimeoutMs: 30_000,
  maximumTimeoutMs: 120_000,
  maximumInputCharacters: 1_000_000,
  maximumOutputCharacters: 100_000,
  maximumOutputTokens: 10_000,
};

export class CountingFileApplyEngineService extends FileApplyEngineService {
  calls = 0;

  override async apply(
    ...parameters: Parameters<FileApplyEngineService['apply']>
  ): Promise<Awaited<ReturnType<FileApplyEngineService['apply']>>> {
    this.calls += 1;
    return super.apply(...parameters);
  }
}

export interface AgentCompositionHarness {
  readonly fileSystem: InMemoryFileSystemPort;
  readonly fileApply: CountingFileApplyEngineService;
  readonly verification: ReturnType<typeof createPortHarness>;
  readonly runtime: WorkspaceRuntimeService;
  readonly correction: CorrectionLoopService;
  readonly agent: AgentOperatingService;
  readonly agentRuns: AgentRunService;
  readonly explainArtifacts: ExplainArtifactPersistence;
  readonly stateRoot: string;
}

export interface CreateAgentCompositionOptions {
  readonly stateRoot: string;
  readonly runId?: string;
  readonly projectId?: string;
  readonly clockIso?: string;
  readonly failedVerification?: boolean;
  readonly includeBrowserVerification?: boolean;
  /** After first provider response, emit UPDATE_FILE for correction re-apply. */
  readonly correctionUpdateOnSecondPrepare?: boolean;
}

export function createStubInvestigation(
  investigationId = 'inv-e2e-1',
): AgentOperatingInvestigationPort {
  return {
    investigate: async (request) =>
      ({
        investigationId,
        request,
        report: {
          schemaVersion: 1,
          investigationId,
          summary: 'E2E investigation',
          confidence: 'MEDIUM',
          hypotheses: [],
          evidence: [],
          affectedAreas: [],
          recommendedNextSteps: ['prepare'],
          limitations: [],
        },
        searchResult: {
          schemaVersion: 1,
          matches: [],
          queries: [],
          truncated: false,
        },
        repositorySourcePaths: [],
        bounded: true,
      }) as never,
    resolveInvestigationHandoff: () => undefined,
  };
}

export function createAgentCompositionHarness(
  options: CreateAgentCompositionOptions,
): AgentCompositionHarness {
  const projectId = options.projectId ?? 'builder-ai';
  const clockIso = options.clockIso ?? '2026-08-21T15:00:00.000Z';
  const fileSystem = new InMemoryFileSystemPort();
  const fileApply = new CountingFileApplyEngineService(fileSystem);
  const failedStage: VerificationStagePortResult = {
    status: 'FAILED',
    warnings: [],
    errors: [{ code: 'STAGE_FAILED', message: 'Simulated stage failure.' }],
    metadata: {},
  };
  const verification = options.failedVerification
    ? createPortHarness({ BUILD_VALIDATION: failedStage })
    : createPortHarness();
  const runtime = createCompositionRuntime({
    fileSystem,
    verificationPorts: verification.ports,
    fileApply,
    includeBrowserVerification: options.includeBrowserVerification === true,
    correctionUpdateOnSecondPrepare: options.correctionUpdateOnSecondPrepare === true,
    switchVerificationToPassAfterFirstFailure: options.failedVerification === true,
  });
  const correction = new CorrectionLoopService();
  const agentRuns = new AgentRunService(
    new AgentRunPersistence(options.stateRoot, projectId),
    () => new Date(clockIso),
  );
  const explainArtifacts = new ExplainArtifactPersistence(options.stateRoot, projectId);
  const agent = new AgentOperatingService({
    projectId,
    agentRuns,
    explainArtifacts,
    investigation: createStubInvestigation(),
    runtime,
    correction,
    ids: { generate: () => options.runId ?? 'agent-run-e2e-1' },
    clock: { now: () => new Date(clockIso) },
  });
  return {
    fileSystem,
    fileApply,
    verification,
    runtime,
    correction,
    agent,
    agentRuns,
    explainArtifacts,
    stateRoot: options.stateRoot,
  };
}

export function reloadAgentCompositionHarness(
  prior: AgentCompositionHarness,
  options: {
    readonly clockIso?: string;
    readonly runId?: string;
  } = {},
): AgentOperatingService {
  const clockIso = options.clockIso ?? '2026-08-21T16:00:00.000Z';
  const agentRuns = new AgentRunService(
    new AgentRunPersistence(prior.stateRoot, 'builder-ai'),
    () => new Date(clockIso),
  );
  return new AgentOperatingService({
    projectId: 'builder-ai',
    agentRuns,
    explainArtifacts: new ExplainArtifactPersistence(prior.stateRoot, 'builder-ai'),
    investigation: createStubInvestigation(),
    // Intentionally broken runtime — restart must not auto-plan/apply.
    runtime: {
      prepare: async () => {
        throw new Error('prepare must not run on reload');
      },
      approveAndApply: async () => {
        throw new Error('apply must not run on reload');
      },
    },
    correction: new CorrectionLoopService(),
    ids: { generate: () => options.runId ?? 'unused' },
    clock: { now: () => new Date(clockIso) },
  });
}

function createCompositionRuntime(input: {
  readonly fileSystem: InMemoryFileSystemPort;
  readonly verificationPorts: ConstructorParameters<typeof VerificationEngineService>[0];
  readonly fileApply: FileApplyEngineService;
  readonly includeBrowserVerification: boolean;
  readonly correctionUpdateOnSecondPrepare: boolean;
  readonly switchVerificationToPassAfterFirstFailure: boolean;
}): WorkspaceRuntimeService {
  let providerTick = 0;
  let prepareResponses = 0;
  let verifyAttempts = 0;
  const providerClock = (): string =>
    new Date(Date.parse('2026-07-31T13:00:00.000Z') + providerTick++ * 10).toISOString();

  const provider = new OpenAIProvider(
    PROVIDER_CONFIGURATION,
    {
      create: async () => {
        prepareResponses += 1;
        const useUpdate = input.correctionUpdateOnSecondPrepare && prepareResponses > 1;
        return {
          id: `response-agent-e2e-${prepareResponses}`,
          model: 'integration-model',
          status: 'completed',
          output_text: JSON.stringify({
            summary: useUpdate
              ? 'Corrected the integration artifact.'
              : 'Created an integration artifact.',
            artifacts: [
              {
                logicalPath: 'src/integration-output.ts',
                type: 'SOURCE_FILE',
                content: useUpdate
                  ? 'export const integrated = true;\nexport const corrected = true;\n'
                  : 'export const integrated = true;\n',
                metadata: {
                  description: useUpdate
                    ? 'Update the integration artifact'
                    : 'Create the integration artifact',
                  'change-operation': useUpdate ? 'UPDATE_FILE' : 'CREATE_FILE',
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

  let idTick = 0;
  const timestamp = new Date('2026-07-31T13:00:00.000Z');
  const verificationEngine = new VerificationEngineService(input.verificationPorts);

  // After first failed verification in correction E2E, subsequent verifies pass.
  if (input.switchVerificationToPassAfterFirstFailure) {
    const originalVerify = verificationEngine.verify.bind(verificationEngine);
    verificationEngine.verify = async (context) => {
      verifyAttempts += 1;
      if (verifyAttempts === 1) {
        return originalVerify(context);
      }
      const passed = createPortHarness();
      return new VerificationEngineService(passed.ports).verify(context);
    };
  }

  return new WorkspaceRuntimeService({
    loadProjectBrain: loadCanonicalProjectBrain,
    blueprintReader: new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    projectRoot: process.cwd(),
    sourceFiles: {
      listSourcePaths: async () => [],
      readSourceFile: async (logicalPath: string) => {
        if (logicalPath === 'src/integration-output.ts') {
          return 'export const integrated = true;\n';
        }
        throw new Error(`Unexpected source read: ${logicalPath}`);
      },
    },
    contextBuilder: new ContextBuilderService(),
    promptOrchestrator: new PromptOrchestratorService(),
    workspaceBaseline: new NullWorkspaceBaselinePort(),
    providerExecution: new OpenAIExecutionService(provider, PROVIDER_CONFIGURATION, providerClock),
    responseProcessor: new ResponseProcessorService(),
    changePlanner: new ChangePlannerService(),
    fileApply: input.fileApply,
    verification: verificationEngine,
    ...(input.includeBrowserVerification
      ? {
          runtimeBrowserVerification: {
            async verify() {
              return {
                schemaVersion: 1 as const,
                status: 'PASSED' as const,
                server: {
                  descriptorId: 'npm-run-dev',
                  status: 'READY' as const,
                  url: 'http://127.0.0.1:39990',
                  port: 39_990,
                  startupDurationMs: 1,
                },
                browser: {
                  status: 'PASSED' as const,
                  durationMs: 1,
                  routes: [
                    {
                      path: '/',
                      status: 'PASSED' as const,
                      durationMs: 1,
                      consoleErrors: [],
                      pageExceptions: [],
                      failedRequests: [],
                    },
                  ],
                  consoleErrorCount: 0,
                  pageExceptionCount: 0,
                  failedRequestCount: 0,
                },
                durationMs: 1,
                metadata: {},
              };
            },
          },
        }
      : {}),
    clock: { now: () => new Date(timestamp) },
    ids: {
      generate: () => {
        idTick += 1;
        return `123e4567-e89b-12d3-a456-426614174${String(idTick).padStart(3, '0')}`;
      },
    },
    logger: { record: () => undefined },
  });
}
