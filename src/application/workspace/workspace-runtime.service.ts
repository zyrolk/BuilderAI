import type { ProjectContextReaderPort } from '../../core/target-project';
import {
  ExternalTargetOnboardingError,
  type WorkspacePathProtectionPolicy,
} from '../../core/target-project';
import type { WorkspaceProjectProfile } from '../../core/target-project/workspace-project-profile.types';
import { DEFAULT_WORKSPACE_PATH_PROTECTION } from '../../core/target-project/workspace-path-protection';
import { assertExternalTargetWorkflowAllowed } from './external-target-readiness';
import type { ExternalTargetReadiness } from './external-target-readiness';
import type { ChangePlannerService, ProjectChangePlan } from '../../core/change-planner';
import type { ProjectChangeOperation } from '../../core/change-planner';
import type { WorkspaceBaselinePort } from '../../core/change-planner/ports/workspace-baseline.port';
import type { ContextBuilderService, ProjectFileSource } from '../../core/context-builder';
import type { ExecutionCancellationToken } from '../../core/execution-engine';
import type { ExecutionRequest } from '../../core/execution-engine';
import {
  isVerificationEligibleFileApplyResult,
  isZeroMutationFileApplyResult,
  type FileApplyEngineService,
  type FileApplyResult,
} from '../../core/file-apply';
import { parseProjectBrain, type ProjectBrain, type ProjectTask } from '../../core/project-brain';
import {
  DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION,
  type PromptIterationContent,
  type PromptOrchestratorService,
  type PromptPackage,
} from '../../core/prompt-orchestrator';
import type { ResponseProcessorService, ResponsePackage } from '../../core/response-processor';
import { PrepareScopeService, type UpdateScopePlan } from '../../core/update-scope';
import type { ContextPackage, SourceContextPolicy } from '../../core/context-builder';
import type { VerificationEngineService, VerificationReport } from '../../core/verification';
import type { RuntimeBrowserVerificationReport } from '../../core/runtime-verification';
import type { ActivityHistoryService } from './activity-history.service';
import type { WorkspaceActivity } from './activity-history.types';
import { WorkspaceApplyAuditService } from './workspace-apply-audit.service';
import {
  listChangePlanTargetPaths,
  WorkspaceApplyLockService,
} from './workspace-apply-lock.service';
import { WorkspaceApplyPolicyService } from './workspace-apply-policy.service';
import {
  createWorkspaceAuthorizationContext,
  WorkspaceAuthorizationService,
} from './workspace-authorization.service';
import type {
  WorkspaceRequestSecurityEvidence,
  WorkspaceSecurityConfiguration,
} from './workspace-authorization.types';
import {
  createFileApplicationCompletedActivity,
  createFileApplicationFailedActivity,
  createVerificationCompletedActivity,
  summarizeChangePlan,
  type ActivityHistoryIdentity,
} from './workspace-activity-history.mapper';
import {
  buildFeatureTaskRequest,
  createFeatureTransientTask,
  createShadowDependencyTasks,
} from './feature-plan.service';
import type { FeatureTaskPrepareInput } from './workspace-runtime.types';
import { InMemoryPreparationStore, MAXIMUM_APPLY_ATTEMPTS } from './in-memory-preparation.store';
import { Gate2ReviewProjectionService } from './gate2-review';
import {
  buildExternalTargetInvestigationPreparePlan,
  buildPrepareContextSelectionDiagnostics,
  PrepareConfidentialityBoundary,
  type ExternalTargetPrepareContextBudget,
  type PrepareContextSelectionDiagnostics,
} from './prepare-context';
import {
  extractInvestigationHandoffPathHints,
  isInvestigationHandoffFeedback,
} from './investigation/investigation-handoff';
import { isOperatorToolPlanningMergeInput } from './agent-operating/operator-tool-planning-prepare-input';
import {
  isAgentOperatingPlanPrepareInput,
  unwrapPlanningInner,
} from './agent-operating/verification-planning-prepare-input';
import {
  isCorrectionPrepareInput,
  sanitizeStructuredFailureDiagnostics,
} from './correction-loop/correction-prepare-input';
import { serializeUntrustedFailureDiagnostics } from './correction-loop/serialize-untrusted-failure-diagnostics';
import type { VerificationPlanningProjection } from './agent-operating/verification-planning-projection';
import type { ProjectMemoryService } from './project-memory/project-memory.service';
import {
  extractIterationPathHints,
  normalizeIterationFeedback,
} from './iteration-feedback.service';
import {
  DEFAULT_WORKSPACE_RUNTIME_CONFIGURATION,
  WorkspaceRuntimeError,
  type FeatureTaskPreparationBinding,
  type ProviderExecutionPort,
  type WorkspaceCompletion,
  type WorkspacePreparation,
  type WorkspaceRuntimeClock,
  type WorkspaceRuntimeConfiguration,
  type WorkspaceRuntimeIdGenerator,
  type WorkspaceRuntimeLogger,
} from './workspace-runtime.types';
import type { PrepareOutcome } from './prepare-outcome';
import type { RuntimeBrowserVerificationPort } from './runtime-browser-verification.port';
import type { WorkflowLedgerOrchestrationService } from './workflow-ledger';
import { digestChangePlanOperations } from '../../core/workflow-ledger';

interface WorkspaceRuntimeDependencies {
  readonly loadProjectBrain: () => ProjectBrain;
  readonly blueprintReader: ProjectContextReaderPort;
  readonly sourceFiles: ProjectFileSource;
  readonly contextBuilder: ContextBuilderService;
  readonly promptOrchestrator: PromptOrchestratorService;
  readonly workspaceBaseline: WorkspaceBaselinePort;
  readonly providerExecution: ProviderExecutionPort;
  readonly responseProcessor: ResponseProcessorService;
  readonly changePlanner: ChangePlannerService;
  readonly fileApply: FileApplyEngineService;
  readonly fileApplyCheckpoint?: {
    bindWorkflow?(workflowId: string): void | Promise<void>;
    finish?(status: 'COMPLETED' | 'FAILED'): void | Promise<void>;
  };
  readonly verification: VerificationEngineService;
  readonly runtimeBrowserVerification?: RuntimeBrowserVerificationPort;
  readonly builderAiRoot?: string;
  readonly clock: WorkspaceRuntimeClock;
  readonly ids: WorkspaceRuntimeIdGenerator;
  readonly logger: WorkspaceRuntimeLogger;
  readonly activityHistory?: ActivityHistoryService;
  readonly configuration?: WorkspaceRuntimeConfiguration;
  readonly prepareScope?: PrepareScopeService;
  readonly security?: WorkspaceSecurityConfiguration;
  readonly projectRoot?: string;
  readonly applyLock?: WorkspaceApplyLockService;
  readonly projectMemory?: ProjectMemoryService;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
  readonly projectProfile?: WorkspaceProjectProfile;
  readonly evaluateExternalTargetReadiness?: () => Promise<ExternalTargetReadiness | undefined>;
  readonly workflowLedger?: WorkflowLedgerOrchestrationService;
  readonly projectId?: string;
}

export class WorkspaceRuntimeService {
  private readonly configuration: WorkspaceRuntimeConfiguration;
  private readonly store: InMemoryPreparationStore;
  private readonly gate2ReviewProjection: Gate2ReviewProjectionService;
  private readonly prepareScope: PrepareScopeService;
  private readonly security: WorkspaceSecurityConfiguration;
  private readonly authorization: WorkspaceAuthorizationService;
  private readonly applyLock: WorkspaceApplyLockService;
  private readonly applyPolicy: WorkspaceApplyPolicyService;
  private readonly applyAudit?: WorkspaceApplyAuditService;
  private readonly prepareConfidentiality: PrepareConfidentialityBoundary;

  constructor(private readonly dependencies: WorkspaceRuntimeDependencies) {
    this.configuration = dependencies.configuration ?? DEFAULT_WORKSPACE_RUNTIME_CONFIGURATION;
    validateConfiguration(this.configuration);
    this.gate2ReviewProjection = new Gate2ReviewProjectionService(
      undefined,
      dependencies.pathProtection ?? DEFAULT_WORKSPACE_PATH_PROTECTION,
    );
    this.store = new InMemoryPreparationStore(
      dependencies.clock,
      this.configuration.maximumPreparations,
    );
    this.prepareScope = dependencies.prepareScope ?? new PrepareScopeService();
    this.prepareConfidentiality = new PrepareConfidentialityBoundary(
      dependencies.projectProfile ?? 'BUILDERAI_SELF',
      dependencies.sourceFiles,
      dependencies.workspaceBaseline,
      dependencies.pathProtection,
    );
    this.security = dependencies.security ?? defaultTrustedLocalSecurity();
    this.authorization = new WorkspaceAuthorizationService(this.security);
    this.applyLock = dependencies.applyLock ?? new WorkspaceApplyLockService();
    this.applyPolicy = new WorkspaceApplyPolicyService();
    this.applyAudit =
      dependencies.projectRoot === undefined
        ? undefined
        : new WorkspaceApplyAuditService({ projectRoot: dependencies.projectRoot });
  }

  async prepare(
    request: string,
    iterationFeedbackInput?: unknown,
    cancellation?: ExecutionCancellationToken,
  ): Promise<WorkspacePreparation> {
    await this.assertExternalTargetWorkflowAllowed('PREPARE');
    const normalizedRequest = validateRequest(request);
    const planPrepare = isAgentOperatingPlanPrepareInput(iterationFeedbackInput)
      ? iterationFeedbackInput
      : undefined;
    const correctionPrepare = isCorrectionPrepareInput(iterationFeedbackInput)
      ? iterationFeedbackInput
      : undefined;
    const verificationPlanningContext = planPrepare?.verificationPlanning;
    const untrustedFailureDiagnosticsText =
      correctionPrepare === undefined
        ? undefined
        : serializeUntrustedFailureDiagnostics(
            sanitizeStructuredFailureDiagnostics(correctionPrepare.structuredFailureDiagnostics),
          );
    const planningInner =
      planPrepare !== undefined
        ? unwrapPlanningInner(planPrepare.planning)
        : { merge: undefined, handoff: undefined };
    const effectivePlanningInput =
      planPrepare !== undefined
        ? (planPrepare.planning ?? undefined)
        : correctionPrepare !== undefined
          ? undefined
          : iterationFeedbackInput;

    const operatorPlanningMerge =
      planningInner.merge !== undefined
        ? planningInner.merge
        : isOperatorToolPlanningMergeInput(effectivePlanningInput)
          ? effectivePlanningInput
          : undefined;
    const investigationHandoff =
      operatorPlanningMerge !== undefined
        ? this.prepareConfidentiality.filterInvestigationHandoff(
            operatorPlanningMerge.mergedHandoff,
          )
        : planningInner.handoff !== undefined
          ? this.prepareConfidentiality.filterInvestigationHandoff(planningInner.handoff)
          : isInvestigationHandoffFeedback(effectivePlanningInput)
            ? this.prepareConfidentiality.filterInvestigationHandoff(effectivePlanningInput)
            : undefined;
    const normalizedFeedback =
      investigationHandoff === undefined &&
      operatorPlanningMerge === undefined &&
      planPrepare === undefined &&
      (correctionPrepare !== undefined || iterationFeedbackInput !== undefined)
        ? normalizeIterationFeedback(
            correctionPrepare?.iterationFeedback ?? iterationFeedbackInput,
            {
              priorRequestSummary: readOptionalPriorSummary(
                correctionPrepare?.iterationFeedback ?? iterationFeedbackInput,
              ),
            },
          )
        : undefined;
    const iterationPathHints = this.prepareConfidentiality.filterPaths(
      investigationHandoff !== undefined
        ? extractInvestigationHandoffPathHints(investigationHandoff)
        : normalizedFeedback === undefined
          ? []
          : extractIterationPathHints(normalizedFeedback),
    );
    const externalPreparePlan =
      investigationHandoff !== undefined && this.dependencies.projectProfile === 'EXTERNAL_TARGET'
        ? buildExternalTargetInvestigationPreparePlan({
            prepareRequest: normalizedRequest,
            handoff: investigationHandoff,
          })
        : undefined;
    const correlationId = this.dependencies.ids.generate();
    const startedAt = this.dependencies.clock.now();
    this.log(correlationId, 'PREPARE', 'STARTED');
    if (
      this.dependencies.workflowLedger !== undefined &&
      this.dependencies.projectRoot !== undefined &&
      this.dependencies.projectId !== undefined
    ) {
      await this.dependencies.workflowLedger.beginWorkflow({
        workflowId: correlationId,
        projectId: this.dependencies.projectId,
        repositoryRoot: this.dependencies.projectRoot,
        originalRequest: request,
        normalizedRequest,
      });
    }
    try {
      const canonicalBrain = this.readProjectBrainOrThrow();
      const readerOutput = await this.readProjectContextOrThrow();
      if (
        !readerOutput.valid ||
        readerOutput.analysis === undefined ||
        readerOutput.summary === undefined
      ) {
        throw new WorkspaceRuntimeError(
          'PROJECT_CONTEXT_INVALID',
          'Project documentation did not pass Blueprint Reader validation.',
        );
      }
      const requestedAt = startedAt.toISOString();
      const sourcePaths = await this.prepareConfidentiality.listSourcePaths();
      const prepareAttempts: readonly boolean[] =
        externalPreparePlan === undefined ? [false] : [false, true];
      let lastError: unknown;
      let preparedArtifacts:
        | {
            readonly prompt: PromptPackage;
            readonly scopePlan: UpdateScopePlan;
            readonly context: ContextPackage;
            readonly memoryContextCharacters: number;
            readonly prepareContextSelection?: PrepareContextSelectionDiagnostics;
          }
        | undefined;

      const stageStartedAt = startedAt.getTime();
      for (const compactRetry of prepareAttempts) {
        const elapsedMs = this.dependencies.clock.now().getTime() - stageStartedAt;
        const remainingTimeoutMs = Math.max(1, this.configuration.providerTimeoutMs - elapsedMs);
        const activeBudget =
          externalPreparePlan === undefined
            ? undefined
            : compactRetry
              ? externalPreparePlan.compactBudget
              : externalPreparePlan.normalBudget;
        let taskText =
          externalPreparePlan === undefined ? normalizedRequest : externalPreparePlan.taskText;
        let memoryContextCharacters = 0;
        if (this.dependencies.projectMemory?.isEnabled()) {
          const augmented = await this.dependencies.projectMemory.augmentRequestWithMemory({
            request: taskText,
            existingSourcePaths: sourcePaths,
            explicitPathHints: iterationPathHints,
            ...(activeBudget === undefined
              ? {}
              : {
                  memoryBudget: {
                    maximumContextCharacters: activeBudget.memoryContextCharacters,
                    maximumRelevantRecords: activeBudget.memoryRelevantRecords,
                  },
                }),
          });
          taskText = augmented.request;
          memoryContextCharacters = augmented.memoryContext.renderedText.length;
        }
        const transientTask = createTransientTask(correlationId, taskText, requestedAt);
        const executionBrain = createExecutionBrain(canonicalBrain, [transientTask]);
        try {
          preparedArtifacts = {
            ...(await this.buildScopedPrepareArtifacts({
              taskText,
              executionBrain,
              readerOutput,
              currentTaskId: transientTask.id,
              iterationPathHints:
                externalPreparePlan === undefined
                  ? iterationPathHints
                  : externalPreparePlan.iterationPathHints,
              correlationId,
              metadata: {
                'correlation-id': correlationId,
                source: 'workspace',
                ...(externalPreparePlan === undefined
                  ? {}
                  : { 'prepare-context-profile': 'EXTERNAL_TARGET_INVESTIGATION_PREPARE' }),
              },
              iterationFeedback:
                externalPreparePlan === undefined
                  ? (normalizedFeedback as PromptIterationContent | undefined)
                  : externalPreparePlan.iterationFeedback,
              ...(verificationPlanningContext === undefined ? {} : { verificationPlanningContext }),
              ...(untrustedFailureDiagnosticsText === undefined ||
              untrustedFailureDiagnosticsText.length === 0
                ? {}
                : { untrustedFailureDiagnosticsText }),
              ...(externalPreparePlan === undefined
                ? {}
                : {
                    sourceContextPolicy: externalPreparePlan.sourceContextPolicy(compactRetry),
                    contextBudget: activeBudget,
                  }),
              memoryContextCharacters,
              compactRetryUsed: compactRetry,
            })),
            memoryContextCharacters,
          };
          const executionRequest = createExecutionRequest(
            correlationId,
            preparedArtifacts.prompt,
            requestedAt,
            remainingTimeoutMs,
            cancellation,
          );
          const providerOutput =
            await this.dependencies.providerExecution.execute(executionRequest);
          const responsePackage = await this.dependencies.responseProcessor.process({
            providerResponse: providerOutput.providerResponse,
            executionResult: providerOutput.executionResult,
            metadata: { 'correlation-id': correlationId },
          });
          const changePlan = this.dependencies.changePlanner.plan(
            responsePackage,
            undefined,
            undefined,
            preparedArtifacts.scopePlan,
          );
          const gate2Review = this.gate2ReviewProjection.project(
            changePlan,
            this.dependencies.workspaceBaseline,
          );
          const expiresAt = new Date(startedAt.getTime() + this.configuration.preparationTtlMs);
          const applyAuthorizationToken = this.issueApplyAuthorizationToken();
          this.store.save(
            correlationId,
            changePlan,
            gate2Review,
            expiresAt,
            undefined,
            applyAuthorizationToken,
          );
          if (this.dependencies.workflowLedger !== undefined) {
            await this.dependencies.workflowLedger.recordPrepareCompleted({
              workflowId: correlationId,
              preparationId: correlationId,
              changePlan,
              gate2Review,
              providerIdentity: providerOutput.executionResult.executionId,
              contextPackageDigest: this.dependencies.workflowLedger.digestContextPackage({
                metadata: {
                  sourceContextCharacters:
                    preparedArtifacts.prompt.metadata.sourceContextCharacters,
                },
              }),
              promptPackageDigest: this.dependencies.workflowLedger.digestPromptPackage({
                metadata: {
                  templateId: preparedArtifacts.prompt.template.id,
                },
              }),
              providerAttemptSummary: '1',
            });
          }
          const outcome = classifyPrepareOutcome(changePlan);
          this.log(correlationId, 'PREPARE', 'SUCCEEDED', startedAt);
          return {
            preparationId: correlationId,
            expiresAt: expiresAt.toISOString(),
            responsePackage,
            changePlan,
            gate2Review,
            outcome,
            ...(applyAuthorizationToken === undefined ? {} : { applyAuthorizationToken }),
            ...(preparedArtifacts.prepareContextSelection === undefined
              ? {}
              : { prepareContextSelection: preparedArtifacts.prepareContextSelection }),
          };
        } catch (error: unknown) {
          lastError = error;
          if (
            externalPreparePlan !== undefined &&
            !compactRetry &&
            isOutputTruncatedFailure(error)
          ) {
            continue;
          }
          throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Prepare failed.');
    } catch (error: unknown) {
      this.log(correlationId, 'PREPARE', 'FAILED', startedAt, safeCode(error));
      if (isProviderError(error)) wrapProviderError(error);
      throw error;
    }
  }

  async prepareFeatureTask(input: FeatureTaskPrepareInput): Promise<WorkspacePreparation> {
    await this.assertExternalTargetWorkflowAllowed('PREPARE');
    const taskRequest =
      input.request.trim().length > 0 ? input.request.trim() : buildFeatureTaskRequest(input.task);
    const normalizedRequest = validateRequest(taskRequest);
    const normalizedFeedback = input.iterationFeedback;
    const iterationPathHints = this.prepareConfidentiality.filterPaths(
      mergePathHints(
        input.task.expectedAreas,
        input.iterationPathHints ?? [],
        normalizedFeedback === undefined ? [] : extractIterationPathHints(normalizedFeedback),
      ),
    );
    const correlationId = this.dependencies.ids.generate();
    const startedAt = this.dependencies.clock.now();
    const featureBinding: FeatureTaskPreparationBinding = {
      featurePlanId: input.plan.featurePlanId,
      taskId: input.task.taskId,
    };
    this.log(correlationId, 'PREPARE_FEATURE_TASK', 'STARTED');
    if (
      this.dependencies.workflowLedger !== undefined &&
      this.dependencies.projectRoot !== undefined &&
      this.dependencies.projectId !== undefined
    ) {
      await this.dependencies.workflowLedger.beginWorkflow({
        workflowId: correlationId,
        projectId: this.dependencies.projectId,
        repositoryRoot: this.dependencies.projectRoot,
        originalRequest: taskRequest,
        normalizedRequest: normalizedRequest,
      });
    }
    await this.recordFeatureActivity({
      binding: featureBinding,
      correlationId,
      activity: {
        type: 'TASK_PREPARATION_STARTED',
        payload: {},
      },
    });
    try {
      const canonicalBrain = this.readProjectBrainOrThrow();
      const readerOutput = await this.readProjectContextOrThrow();
      if (
        !readerOutput.valid ||
        readerOutput.analysis === undefined ||
        readerOutput.summary === undefined
      ) {
        throw new WorkspaceRuntimeError(
          'PROJECT_CONTEXT_INVALID',
          'Project documentation did not pass Blueprint Reader validation.',
        );
      }
      const requestedAt = startedAt.toISOString();
      const shadowTasks = createShadowDependencyTasks(input.plan, input.task, requestedAt);
      const transientTask = createFeatureTransientTask(
        input.plan,
        input.task,
        normalizedRequest,
        correlationId,
        requestedAt,
        shadowTasks,
      );
      const executionBrain = createExecutionBrain(canonicalBrain, [...shadowTasks, transientTask]);
      const { prompt, scopePlan } = await this.buildScopedPrepareArtifacts({
        taskText: normalizedRequest,
        executionBrain,
        readerOutput,
        currentTaskId: transientTask.id,
        iterationPathHints,
        correlationId,
        metadata: {
          'correlation-id': correlationId,
          source: 'workspace-feature-task',
          'feature-plan-id': input.plan.featurePlanId,
          'task-id': input.task.taskId,
        },
        iterationFeedback: normalizedFeedback as PromptIterationContent | undefined,
      });
      const executionRequest = createExecutionRequest(
        correlationId,
        prompt,
        requestedAt,
        this.configuration.providerTimeoutMs,
      );
      const providerOutput = await this.dependencies.providerExecution.execute(executionRequest);
      const responsePackage = await this.dependencies.responseProcessor.process({
        providerResponse: providerOutput.providerResponse,
        executionResult: providerOutput.executionResult,
        metadata: { 'correlation-id': correlationId },
      });
      const changePlan = this.dependencies.changePlanner.plan(
        responsePackage,
        undefined,
        undefined,
        scopePlan,
      );
      const gate2Review = this.gate2ReviewProjection.project(
        changePlan,
        this.dependencies.workspaceBaseline,
      );
      const expiresAt = new Date(startedAt.getTime() + this.configuration.preparationTtlMs);
      const applyAuthorizationToken = this.issueApplyAuthorizationToken();
      this.store.save(
        correlationId,
        changePlan,
        gate2Review,
        expiresAt,
        featureBinding,
        applyAuthorizationToken,
      );
      if (this.dependencies.workflowLedger !== undefined) {
        await this.dependencies.workflowLedger.recordPrepareCompleted({
          workflowId: correlationId,
          preparationId: correlationId,
          changePlan,
          gate2Review,
          providerIdentity: providerOutput.executionResult.executionId,
          contextPackageDigest: this.dependencies.workflowLedger.digestContextPackage({
            metadata: {
              sourceContextCharacters: prompt.metadata.sourceContextCharacters,
            },
          }),
          promptPackageDigest: this.dependencies.workflowLedger.digestPromptPackage({
            metadata: { templateId: prompt.template.id },
          }),
          providerAttemptSummary: '1',
        });
      }
      const durationMs = Math.max(0, this.dependencies.clock.now().getTime() - startedAt.getTime());
      await this.recordFeatureActivity({
        binding: featureBinding,
        correlationId,
        activity: {
          type: 'TASK_PREPARATION_COMPLETED',
          payload: {
            durationMs,
            changePlanSummary: summarizeChangePlan(changePlan),
          },
        },
      });
      this.log(correlationId, 'PREPARE_FEATURE_TASK', 'SUCCEEDED', startedAt);
      return {
        preparationId: correlationId,
        expiresAt: expiresAt.toISOString(),
        responsePackage,
        changePlan,
        gate2Review,
        ...(applyAuthorizationToken === undefined ? {} : { applyAuthorizationToken }),
      };
    } catch (error: unknown) {
      const durationMs = Math.max(0, this.dependencies.clock.now().getTime() - startedAt.getTime());
      await this.recordFeatureActivity({
        binding: featureBinding,
        correlationId,
        activity: {
          type: 'TASK_PREPARATION_FAILED',
          payload: {
            durationMs,
            errorCode: safeCode(error),
            errorMessage: safeMessage(error),
          },
        },
      });
      this.log(correlationId, 'PREPARE_FEATURE_TASK', 'FAILED', startedAt, safeCode(error));
      throw error;
    }
  }

  /**
   * B3 / ADR-039: commit a server-built ResponsePackage into the existing preparation store
   * (ChangePlanner → Gate2 → store). Does not mutate the target filesystem and does not approve.
   */
  async prepareFromResponsePackage(
    responsePackage: ResponsePackage,
  ): Promise<WorkspacePreparation> {
    await this.assertExternalTargetWorkflowAllowed('PREPARE');
    const correlationId = this.dependencies.ids.generate();
    const startedAt = this.dependencies.clock.now();
    this.log(correlationId, 'PREPARE_FROM_RESPONSE_PACKAGE', 'STARTED');
    try {
      if (
        this.dependencies.workflowLedger !== undefined &&
        this.dependencies.projectRoot !== undefined &&
        this.dependencies.projectId !== undefined
      ) {
        await this.dependencies.workflowLedger.beginWorkflow({
          workflowId: correlationId,
          projectId: this.dependencies.projectId,
          repositoryRoot: this.dependencies.projectRoot,
          originalRequest: 'edit-proposal-commit',
          normalizedRequest: 'edit-proposal-commit',
        });
      }

      const changePlan = this.dependencies.changePlanner.plan(
        responsePackage,
        undefined,
        this.dependencies.workspaceBaseline,
      );
      const gate2Review = this.gate2ReviewProjection.project(
        changePlan,
        this.dependencies.workspaceBaseline,
      );
      const expiresAt = new Date(startedAt.getTime() + this.configuration.preparationTtlMs);
      const applyAuthorizationToken = this.issueApplyAuthorizationToken();
      this.store.save(
        correlationId,
        changePlan,
        gate2Review,
        expiresAt,
        undefined,
        applyAuthorizationToken,
      );
      if (this.dependencies.workflowLedger !== undefined) {
        await this.dependencies.workflowLedger.recordPrepareCompleted({
          workflowId: correlationId,
          preparationId: correlationId,
          changePlan,
          gate2Review,
          providerIdentity: responsePackage.executionResult.executionId,
          contextPackageDigest: this.dependencies.workflowLedger.digestContextPackage({
            metadata: { sourceContextCharacters: 0 },
          }),
          promptPackageDigest: this.dependencies.workflowLedger.digestPromptPackage({
            metadata: { templateId: 'edit-proposal' },
          }),
          providerAttemptSummary: '0',
        });
      }
      this.log(correlationId, 'PREPARE_FROM_RESPONSE_PACKAGE', 'SUCCEEDED', startedAt);
      return {
        preparationId: correlationId,
        expiresAt: expiresAt.toISOString(),
        responsePackage,
        changePlan,
        gate2Review,
        ...(applyAuthorizationToken === undefined ? {} : { applyAuthorizationToken }),
      };
    } catch (error: unknown) {
      this.log(
        correlationId,
        'PREPARE_FROM_RESPONSE_PACKAGE',
        'FAILED',
        startedAt,
        safeCode(error),
      );
      throw error;
    }
  }

  async approveAndApply(
    preparationId: string,
    approved: boolean,
    evidence?: WorkspaceRequestSecurityEvidence,
    cancellation?: ExecutionCancellationToken,
  ): Promise<WorkspaceCompletion> {
    await this.assertExternalTargetWorkflowAllowed('APPLY');
    const requestEvidence = evidence ?? { operatorApproved: approved };
    const authorizationContext = createWorkspaceAuthorizationContext({
      configuration: this.security,
      action: 'APPLY',
      evidence: { ...requestEvidence, operatorApproved: approved },
    });
    const authorizationDecision = this.authorization.authorize(authorizationContext);
    if (authorizationDecision.outcome === 'REJECTED') {
      this.recordApplyAudit({
        correlationId: preparationId,
        preparationId,
        principal: authorizationContext.principal,
        authorizationOutcome: 'REJECTED',
        reasonCode: authorizationDecision.code,
      });
      throw new WorkspaceRuntimeError(
        authorizationDecision.code ?? 'UNAUTHORIZED',
        authorizationDecision.message ?? 'The workspace apply request is not authorized.',
      );
    }

    if (!approved) {
      throw new WorkspaceRuntimeError('APPROVAL_REQUIRED', 'Explicit approval is required.');
    }
    if (!isIdentifier(preparationId)) {
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Preparation identifier is invalid.');
    }

    const tokenDecision = this.authorization.validateApplyAuthorizationToken(
      preparationId,
      requestEvidence.applyAuthorizationToken,
      this.store,
    );
    if (tokenDecision.outcome === 'REJECTED') {
      this.recordApplyAudit({
        correlationId: preparationId,
        preparationId,
        principal: authorizationContext.principal,
        authorizationOutcome: 'REJECTED',
        reasonCode: tokenDecision.code,
      });
      throw new WorkspaceRuntimeError(
        tokenDecision.code ?? 'APPLY_AUTHORIZATION_REQUIRED',
        tokenDecision.message ?? 'Server-issued apply authorization is required.',
      );
    }

    let applyLeaseAcquired = false;
    if (
      this.dependencies.workflowLedger !== undefined &&
      this.dependencies.projectRoot !== undefined
    ) {
      const validationRecord = this.store.readForApprovalValidation(preparationId);
      if (validationRecord === undefined) {
        throw new WorkspaceRuntimeError(
          'PREPARATION_NOT_FOUND',
          'Preparation was not found or is no longer valid.',
        );
      }
      const baselineDigest =
        (await this.dependencies.workflowLedger.readBaselineDigest(preparationId)) ?? '';
      await this.dependencies.workflowLedger.recordApprovalGranted({
        workflowId: preparationId,
        preparationId,
        changePlan: validationRecord.plan,
        gate2Review: validationRecord.gate2Review,
        baselineDigest,
        expiresAt: new Date(validationRecord.expiresAt),
        approvalIdentity: String(authorizationContext.principal),
      });
      const ledgerAuthorization = await this.dependencies.workflowLedger.validateApplyAuthorization(
        {
          workflowId: preparationId,
          preparationId,
          changePlan: validationRecord.plan,
          gate2Review: validationRecord.gate2Review,
          repositoryRoot: this.dependencies.projectRoot,
        },
      );
      if (ledgerAuthorization.kind === 'REJECTED') {
        throw new WorkspaceRuntimeError('WORKFLOW_FAILED', ledgerAuthorization.message);
      }
      await this.dependencies.workflowLedger.acquireApplyLease(preparationId);
      applyLeaseAcquired = true;
    }

    const startedAt = this.dependencies.clock.now();
    this.log(preparationId, 'APPLY_AND_VERIFY', 'STARTED');
    const claim = this.store.claim(preparationId);
    if (claim.kind === 'COMPLETED') {
      if (applyLeaseAcquired && this.dependencies.workflowLedger !== undefined) {
        await this.dependencies.workflowLedger.releaseApplyLease(preparationId);
      }
      return claim.completion;
    }

    if (this.dependencies.workflowLedger !== undefined) {
      await this.dependencies.workflowLedger.beginApplyJournal({
        workflowId: preparationId,
        preparationId,
      });
    }

    const targetPaths = listChangePlanTargetPaths(claim.plan.changeSet.operations);
    let locksAcquired = false;
    try {
      this.applyPolicy.assertUpdateBaselineIntegrity(this.security.profile, claim.plan);
    } catch (error: unknown) {
      this.store.fail(preparationId);
      this.recordApplyAudit({
        correlationId: preparationId,
        preparationId,
        principal: authorizationContext.principal,
        operations: claim.plan.changeSet.operations,
        authorizationOutcome: 'AUTHORIZED',
        reasonCode: safeCode(error),
      });
      throw error;
    }

    try {
      this.applyLock.acquire(this.security.projectId, preparationId, targetPaths);
      locksAcquired = true;
    } catch (error: unknown) {
      this.store.fail(preparationId);
      this.recordApplyAudit({
        correlationId: preparationId,
        preparationId,
        principal: authorizationContext.principal,
        operations: claim.plan.changeSet.operations,
        authorizationOutcome: 'AUTHORIZED',
        reasonCode: safeCode(error),
      });
      throw error;
    }

    const featureBinding = claim.featureTaskBinding;
    if (cancellation?.cancelled) {
      this.store.fail(preparationId);
      throw new WorkspaceRuntimeError(
        'PROVIDER_CANCELLED',
        cancellation.reason ?? 'Apply was cancelled before mutation.',
      );
    }
    const applyStartedAt = this.dependencies.clock.now();
    if (featureBinding !== undefined) {
      await this.recordFeatureActivity({
        binding: featureBinding,
        correlationId: preparationId,
        activity: {
          type: 'FILE_APPLICATION_STARTED',
          payload: { changePlanId: claim.plan.source.executionId },
        },
      });
    }
    try {
      let applyResult: FileApplyResult;
      try {
        await this.dependencies.fileApplyCheckpoint?.bindWorkflow?.(preparationId);
        applyResult = await this.dependencies.fileApply.apply(claim.plan);
        await this.dependencies.fileApplyCheckpoint?.finish?.(
          applyResult.status === 'APPLIED' ? 'COMPLETED' : 'FAILED',
        );
      } catch (applyError: unknown) {
        await this.dependencies.fileApplyCheckpoint?.finish?.('FAILED');
        if (featureBinding !== undefined) {
          const durationMs = Math.max(
            0,
            this.dependencies.clock.now().getTime() - applyStartedAt.getTime(),
          );
          await this.recordFeatureActivity({
            binding: featureBinding,
            correlationId: preparationId,
            activity: {
              type: 'FILE_APPLICATION_FAILED',
              payload: {
                durationMs,
                status: 'FAILED',
                errorCode: safeCode(applyError),
                errorMessage: safeMessage(applyError),
              },
            },
          });
        }
        throw applyError;
      }
      if (this.dependencies.workflowLedger !== undefined) {
        await this.recordApplyJournalFromResult(
          preparationId,
          claim.plan.changeSet.operations,
          applyResult,
        );
      }
      if (featureBinding !== undefined) {
        await this.recordApplyOutcome(featureBinding, preparationId, applyResult);
      }
      let verificationReport: VerificationReport | undefined;
      if (isVerificationEligibleFileApplyResult(applyResult)) {
        if (featureBinding !== undefined) {
          await this.recordFeatureActivity({
            binding: featureBinding,
            correlationId: preparationId,
            activity: { type: 'VERIFICATION_STARTED', payload: {} },
          });
        }
        try {
          verificationReport = await this.dependencies.verification.verify(applyResult, {
            cancellation: cancellation ?? neverCancelled(),
          });
          if (featureBinding !== undefined) {
            await this.recordActivitySafely(
              createVerificationCompletedActivity(
                createActivityIdentity(featureBinding, preparationId, this.dependencies),
                verificationReport,
              ),
              preparationId,
            );
          }
        } catch (verificationError: unknown) {
          if (featureBinding !== undefined) {
            const durationMs = Math.max(
              0,
              this.dependencies.clock.now().getTime() - applyStartedAt.getTime(),
            );
            await this.recordFeatureActivity({
              binding: featureBinding,
              correlationId: preparationId,
              activity: {
                type: 'VERIFICATION_FAILED',
                payload: {
                  durationMs,
                  errorCode: safeCode(verificationError),
                  errorMessage: safeMessage(verificationError),
                },
              },
            });
          }
          throw verificationError;
        }
      }
      let runtimeBrowserVerificationReport: RuntimeBrowserVerificationReport | undefined;
      if (
        isVerificationEligibleFileApplyResult(applyResult) &&
        applyResult.status === 'APPLIED' &&
        this.dependencies.runtimeBrowserVerification !== undefined &&
        this.dependencies.projectRoot !== undefined
      ) {
        runtimeBrowserVerificationReport =
          await this.dependencies.runtimeBrowserVerification.verify({
            projectRoot: this.dependencies.projectRoot,
            ...(this.dependencies.builderAiRoot === undefined
              ? {}
              : { builderAiRoot: this.dependencies.builderAiRoot }),
            cancellation: cancellation ?? neverCancelled(),
          });
      }
      const completion: WorkspaceCompletion =
        verificationReport === undefined && runtimeBrowserVerificationReport === undefined
          ? { applyResult }
          : {
              applyResult,
              ...(verificationReport === undefined ? {} : { verificationReport }),
              ...(runtimeBrowserVerificationReport === undefined
                ? {}
                : { runtimeBrowserVerificationReport }),
            };
      if (isZeroMutationFileApplyResult(applyResult) && claim.attempt < MAXIMUM_APPLY_ATTEMPTS) {
        this.store.releaseForRetry(preparationId);
      } else {
        this.store.complete(preparationId, completion);
      }
      this.recordApplyAudit({
        correlationId: preparationId,
        preparationId,
        principal: authorizationContext.principal,
        operations: claim.plan.changeSet.operations,
        authorizationOutcome: 'AUTHORIZED',
        applyResult,
      });
      await this.recordVerifiedCompletedWorkMemory({
        preparationId,
        requestSummary: claim.plan.source.executionId,
        changePlan: claim.plan,
        applyResult,
        verificationReport,
        featureBinding,
      });
      this.log(preparationId, 'APPLY_AND_VERIFY', 'SUCCEEDED', startedAt);
      if (this.dependencies.workflowLedger !== undefined) {
        await this.dependencies.workflowLedger.completeApplyJournal({
          workflowId: preparationId,
          applyResult: applyResult.status,
        });
      }
      return structuredClone(completion);
    } catch (error: unknown) {
      this.store.fail(preparationId);
      this.recordApplyAudit({
        correlationId: preparationId,
        preparationId,
        principal: authorizationContext.principal,
        operations: claim.plan.changeSet.operations,
        authorizationOutcome: 'AUTHORIZED',
        reasonCode: safeCode(error),
      });
      this.log(preparationId, 'APPLY_AND_VERIFY', 'FAILED', startedAt, safeCode(error));
      throw error;
    } finally {
      if (locksAcquired) {
        this.applyLock.release(this.security.projectId, preparationId, targetPaths);
      }
      if (applyLeaseAcquired && this.dependencies.workflowLedger !== undefined) {
        await this.dependencies.workflowLedger.releaseApplyLease(preparationId);
      }
    }
  }

  private async recordApplyJournalFromResult(
    workflowId: string,
    operations: readonly ProjectChangeOperation[],
    applyResult: FileApplyResult,
  ): Promise<void> {
    if (this.dependencies.workflowLedger === undefined) return;
    const timestamp = this.dependencies.clock.now().toISOString();
    for (const operation of operations) {
      const mutated =
        applyResult.createdFiles.includes(operation.logicalPath) ||
        applyResult.updatedFiles.includes(operation.logicalPath) ||
        applyResult.deletedFiles.includes(operation.logicalPath);
      const failed = applyResult.errors.some(
        (error) => error.logicalPath === operation.logicalPath,
      );
      const indeterminate = applyResult.errors.some(
        (error) =>
          error.code === 'INDETERMINATE_MUTATION' && error.logicalPath === operation.logicalPath,
      );
      const operationState = indeterminate
        ? 'UNCERTAIN'
        : failed
          ? 'FAILED'
          : mutated
            ? 'COMPLETED'
            : 'PENDING';
      await this.dependencies.workflowLedger.recordApplyOperation({
        workflowId,
        entry: {
          operationId: operation.operationId,
          operationType: operation.kind,
          logicalPath: operation.logicalPath,
          operationState,
          timestamp,
          rollbackState: failed ? 'UNCERTAIN' : 'NOT_STARTED',
        },
      });
    }
  }

  private issueApplyAuthorizationToken(): string | undefined {
    if (this.security.profile !== 'PROTECTED') return undefined;
    return this.dependencies.ids.generate();
  }

  private async assertExternalTargetWorkflowAllowed(
    action: 'INVESTIGATE' | 'PREPARE' | 'APPLY',
  ): Promise<void> {
    if (this.dependencies.projectProfile !== 'EXTERNAL_TARGET') return;
    const readiness = this.dependencies.evaluateExternalTargetReadiness
      ? await this.dependencies.evaluateExternalTargetReadiness()
      : undefined;
    assertExternalTargetWorkflowAllowed(this.dependencies.projectProfile, readiness, action);
  }

  private readProjectBrainOrThrow(): ProjectBrain {
    try {
      return this.dependencies.loadProjectBrain();
    } catch (error: unknown) {
      throw mapExternalTargetOnboardingError(error);
    }
  }

  private async readProjectContextOrThrow(): Promise<
    Awaited<ReturnType<ProjectContextReaderPort['read']>>
  > {
    try {
      return await this.dependencies.blueprintReader.read();
    } catch (error: unknown) {
      throw mapExternalTargetOnboardingError(error);
    }
  }

  private recordApplyAudit(input: {
    readonly correlationId: string;
    readonly preparationId: string;
    readonly principal: { readonly principalId: string; readonly projectId: string };
    readonly operations?: readonly ProjectChangeOperation[];
    readonly authorizationOutcome: 'AUTHORIZED' | 'REJECTED';
    readonly applyResult?: FileApplyResult;
    readonly reasonCode?: string;
  }): void {
    this.applyAudit?.record(input);
  }

  private async recordApplyOutcome(
    binding: FeatureTaskPreparationBinding,
    correlationId: string,
    applyResult: FileApplyResult,
  ): Promise<void> {
    const identity = createActivityIdentity(binding, correlationId, this.dependencies);
    if (applyResult.status === 'APPLIED' || applyResult.status === 'PARTIALLY_APPLIED') {
      await this.recordActivitySafely(
        createFileApplicationCompletedActivity(identity, applyResult),
        correlationId,
      );
      return;
    }
    await this.recordActivitySafely(
      createFileApplicationFailedActivity(identity, applyResult),
      correlationId,
    );
  }

  private async recordFeatureActivity(input: {
    readonly binding: FeatureTaskPreparationBinding;
    readonly correlationId: string;
    readonly activity: Pick<WorkspaceActivity, 'type' | 'payload'>;
  }): Promise<void> {
    const activity = {
      ...createActivityIdentity(input.binding, input.correlationId, this.dependencies),
      type: input.activity.type,
      payload: input.activity.payload,
    } as WorkspaceActivity;
    await this.recordActivitySafely(activity, input.correlationId);
  }

  private async recordActivitySafely(
    activity: WorkspaceActivity,
    correlationId: string,
  ): Promise<void> {
    const recorder = this.dependencies.activityHistory;
    if (recorder === undefined) return;
    try {
      await recorder.recordActivity(activity);
    } catch (error: unknown) {
      this.dependencies.logger.record({
        correlationId,
        stage: 'ACTIVITY_HISTORY_RECORD',
        outcome: 'FAILED',
        code: safeCode(error),
      });
    }
  }

  private async buildScopedPrepareArtifacts(input: {
    readonly taskText: string;
    readonly executionBrain: ProjectBrain;
    readonly readerOutput: Awaited<ReturnType<ProjectContextReaderPort['read']>>;
    readonly currentTaskId: string;
    readonly iterationPathHints: readonly string[];
    readonly correlationId: string;
    readonly metadata: Record<string, string>;
    readonly iterationFeedback?: PromptIterationContent;
    readonly verificationPlanningContext?: VerificationPlanningProjection;
    readonly untrustedFailureDiagnosticsText?: string;
    readonly sourceContextPolicy?: SourceContextPolicy;
    readonly contextBudget?: ExternalTargetPrepareContextBudget;
    readonly memoryContextCharacters?: number;
    readonly compactRetryUsed?: boolean;
  }): Promise<{
    readonly context: ContextPackage;
    readonly prompt: PromptPackage;
    readonly scopePlan: UpdateScopePlan;
    readonly prepareContextSelection?: PrepareContextSelectionDiagnostics;
  }> {
    const sourcePaths = await this.prepareConfidentiality.listSourcePaths();
    const iterationPathHints = this.prepareConfidentiality.filterPaths(input.iterationPathHints);
    const sourceContextPolicy = this.prepareConfidentiality.filterSourceContextPolicy(
      input.sourceContextPolicy,
    );
    const scopeResolution = this.prepareScope.resolve({
      taskText: input.taskText,
      sourcePaths,
      ...(iterationPathHints.length === 0 ? {} : { iterationPathHints }),
      baselinePort: this.prepareConfidentiality,
    });
    const context = await this.dependencies.contextBuilder.build(
      {
        projectBrain: input.executionBrain,
        blueprintReaderOutput: input.readerOutput,
        currentTaskId: input.currentTaskId,
        sourceFileSource: this.prepareConfidentiality,
        ...(iterationPathHints.length === 0 ? {} : { iterationPathHints }),
        ...(scopeResolution.pinnedBaselineFiles.length === 0
          ? {}
          : { pinnedBaselineFiles: scopeResolution.pinnedBaselineFiles }),
        ...(sourceContextPolicy === undefined ? {} : { sourceContextPolicy }),
      },
      {
        ...(input.contextBudget === undefined
          ? {}
          : {
              limitOverrides: input.contextBudget.contextLimits,
              admissionQuotas: input.contextBudget.admissionQuotas,
            }),
      },
    );
    const promptConfiguration =
      input.contextBudget === undefined
        ? DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION
        : {
            ...DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION,
            maximumCharacters: input.contextBudget.promptMaximumCharacters,
          };
    const prompt = await this.dependencies.promptOrchestrator.build(
      {
        context,
        metadata: input.metadata,
        ...(input.iterationFeedback === undefined
          ? {}
          : { iterationFeedback: input.iterationFeedback }),
        ...(input.verificationPlanningContext === undefined
          ? {}
          : { verificationPlanningContext: input.verificationPlanningContext }),
        ...(input.untrustedFailureDiagnosticsText === undefined ||
        input.untrustedFailureDiagnosticsText.length === 0
          ? {}
          : { untrustedFailureDiagnosticsText: input.untrustedFailureDiagnosticsText }),
        ...(scopeResolution.preservationContract === undefined
          ? {}
          : { preservationContract: scopeResolution.preservationContract }),
      },
      promptConfiguration,
    );
    if (input.contextBudget !== undefined) {
      const diagnostics = buildPrepareContextSelectionDiagnostics({
        compactRetryUsed: input.compactRetryUsed ?? false,
        contextPackageCharacters: context.size.characters,
        promptPackageCharacters: JSON.stringify(prompt).length,
        memoryContextCharacters: input.memoryContextCharacters ?? 0,
        relevantFiles: context.relevantFiles.map((file) => ({
          path: file.path,
          content: file.content,
          ...(file.contentPresentation === undefined
            ? {}
            : { contentPresentation: file.contentPresentation }),
        })),
        omissions: context.size.omissions,
      });
      this.dependencies.logger.record({
        correlationId: input.correlationId,
        stage: 'PREPARE_CONTEXT_SELECTION',
        outcome: 'SUCCEEDED',
        code: JSON.stringify(diagnostics),
      });
      return {
        context,
        prompt,
        scopePlan: scopeResolution.scopePlan,
        prepareContextSelection: diagnostics,
      };
    }
    return { context, prompt, scopePlan: scopeResolution.scopePlan };
  }

  private async recordVerifiedCompletedWorkMemory(input: {
    readonly preparationId: string;
    readonly requestSummary: string;
    readonly changePlan: ProjectChangePlan;
    readonly applyResult: FileApplyResult;
    readonly verificationReport?: VerificationReport;
    readonly featureBinding?: FeatureTaskPreparationBinding;
  }): Promise<void> {
    const projectMemory = this.dependencies.projectMemory;
    if (projectMemory === undefined || !projectMemory.isEnabled()) return;
    if (input.applyResult.status !== 'APPLIED') return;
    if (input.verificationReport?.status !== 'PASSED') return;

    const planSummary = summarizeChangePlan(input.changePlan);
    const summary = buildVerifiedCompletedWorkSummary(planSummary);
    const supportingPaths = planSummary.affectedPaths.slice(0, 12);
    try {
      await projectMemory.saveVerifiedCompletedWork({
        preparationId: input.preparationId,
        summary,
        supportingPaths,
        source: input.featureBinding === undefined ? 'VERIFIED_APPLY' : 'FEATURE_TASK',
        workflowId: input.preparationId,
        changePlanDigest: digestChangePlanOperations(input.changePlan),
        verificationSummary: input.verificationReport.status,
        completedAt: this.dependencies.clock.now().toISOString(),
      });
    } catch {
      // Memory persistence must not fail apply/verify completion.
    }
  }

  private log(
    correlationId: string,
    stage: string,
    outcome: 'STARTED' | 'SUCCEEDED' | 'FAILED',
    startedAt?: Date,
    code?: string,
  ): void {
    const durationMs =
      startedAt === undefined
        ? undefined
        : Math.max(0, this.dependencies.clock.now().getTime() - startedAt.getTime());
    this.dependencies.logger.record({
      correlationId,
      stage,
      outcome,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(code === undefined ? {} : { code }),
    });
  }
}

function createTransientTask(id: string, request: string, timestamp: string): ProjectTask {
  return {
    id: `workspace-request-${id}`,
    title: 'Execute an approved workspace request',
    description: request,
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    acceptanceCriteria: [
      'Produce a validated Project Change Plan for explicit review without applying it.',
    ],
    dependencyIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createExecutionBrain(brain: ProjectBrain, tasks: readonly ProjectTask[]): ProjectBrain {
  return parseProjectBrain({ ...brain, tasks: [...brain.tasks, ...tasks] });
}

function mergePathHints(...lists: readonly (readonly string[])[]): readonly string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const hint of list) {
      if (seen.has(hint)) continue;
      seen.add(hint);
      merged.push(hint);
      if (merged.length >= 8) return merged;
    }
  }
  return merged;
}

/**
 * Bounded retry policy for transient provider outages (P0-6 / ADR-019).
 * The execution engine handles per-attempt retry with exponential backoff.
 * The overall stage deadline is enforced by the provider timeout budget.
 */
const RETRY_DELAY_MS = 1_000;

function createExecutionRequest(
  executionId: string,
  prompt: ExecutionRequest['prompt'],
  requestedAt: string,
  timeoutMs: number,
  cancellation?: ExecutionCancellationToken,
): ExecutionRequest {
  return {
    schemaVersion: 1,
    executionId,
    prompt,
    metadata: {
      correlationId: executionId,
      requestedAt,
      values: { source: 'workspace' },
    },
    policy: {
      priority: 'NORMAL',
      validationMode: 'STRICT',
      failureStrategy: 'RETRY_THEN_FAIL',
      retry: {
        maximumRetries: 2,
        delayStrategy: 'EXPONENTIAL',
        baseDelayMs: RETRY_DELAY_MS,
        maximumDelayMs: 30_000,
        retryableErrorCodes: ['OUTPUT_TRUNCATED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT'],
      },
      timeout: { durationMs: timeoutMs, startsAt: 'QUEUED' },
    },
    cancellation: cancellation ?? neverCancelled(),
  };
}

function neverCancelled(): ExecutionCancellationToken {
  return { cancelled: false, subscribe: () => () => undefined };
}

function validateRequest(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 4_000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(normalized)
  ) {
    throw new WorkspaceRuntimeError(
      'INVALID_REQUEST',
      'Request must contain between 1 and 4,000 safe text characters.',
    );
  }
  return normalized;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9-]{8,128}$/u.test(value);
}

function validateConfiguration(configuration: WorkspaceRuntimeConfiguration): void {
  for (const value of [
    configuration.preparationTtlMs,
    configuration.maximumPreparations,
    configuration.providerTimeoutMs,
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Runtime configuration is invalid.');
    }
  }
}

function mapExternalTargetOnboardingError(error: unknown): unknown {
  if (error instanceof ExternalTargetOnboardingError) {
    return new WorkspaceRuntimeError('EXTERNAL_TARGET_ONBOARDING_REQUIRED', error.message);
  }
  return error;
}

function classifyPrepareOutcome(changePlan: ProjectChangePlan): PrepareOutcome {
  if (changePlan.changeSet.operations.length > 0) {
    return { kind: 'READY_FOR_REVIEW' };
  }
  return {
    kind: 'INSUFFICIENT_EVIDENCE',
    reason: 'Provider returned zero operations without explicit no-change signal.',
  };
}

function isProviderError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = Reflect.get(error, 'code');
  if (typeof code !== 'string') return false;
  return [
    'PROVIDER_UNAVAILABLE',
    'TIMEOUT',
    'CANCELLED',
    'OUTPUT_TRUNCATED',
    'CONTRACT_VIOLATION',
    'INVALID_CONFIGURATION',
    'UNSUPPORTED_CAPABILITY',
  ].includes(code);
}

function wrapProviderError(error: unknown): never {
  if (!(error instanceof Error)) throw error;
  const code = Reflect.get(error, 'code');
  if (typeof code !== 'string') throw error;

  const diagnostics = Reflect.get(error, 'diagnostics');
  const providerStatus =
    typeof diagnostics === 'object' && diagnostics !== null
      ? Reflect.get(diagnostics, 'providerStatus')
      : undefined;
  const category =
    typeof diagnostics === 'object' && diagnostics !== null
      ? Reflect.get(diagnostics, 'providerErrorCategory')
      : undefined;

  if (code === 'PROVIDER_UNAVAILABLE' && providerStatus === 429) {
    throw new WorkspaceRuntimeError('PROVIDER_RATE_LIMITED', error.message);
  }
  if (code === 'PROVIDER_UNAVAILABLE') {
    throw new WorkspaceRuntimeError(
      category === 'UPSTREAM_5XX' ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',
      error.message,
    );
  }
  if (code === 'TIMEOUT') {
    throw new WorkspaceRuntimeError('PROVIDER_TIMEOUT', error.message);
  }
  if (code === 'CANCELLED') {
    throw new WorkspaceRuntimeError('PROVIDER_CANCELLED', error.message);
  }
  if (code === 'OUTPUT_TRUNCATED') {
    throw new WorkspaceRuntimeError('OUTPUT_TRUNCATED', error.message);
  }
  if (
    code === 'CONTRACT_VIOLATION' ||
    code === 'INVALID_CONFIGURATION' ||
    code === 'UNSUPPORTED_CAPABILITY'
  ) {
    throw new WorkspaceRuntimeError('INVALID_PROVIDER_RESPONSE', error.message);
  }
  throw error;
}

function isOutputTruncatedFailure(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return Reflect.get(error, 'code') === 'OUTPUT_TRUNCATED';
  }
  return false;
}

function safeCode(error: unknown): string {
  if (error instanceof WorkspaceRuntimeError) return error.code;
  if (typeof error === 'object' && error !== null) {
    const code = Reflect.get(error, 'code');
    if (typeof code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(code)) return code;
  }
  return 'WORKFLOW_FAILED';
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return 'Workspace operation failed.';
}

function createActivityIdentity(
  binding: FeatureTaskPreparationBinding,
  correlationId: string,
  dependencies: Pick<WorkspaceRuntimeDependencies, 'clock' | 'ids'>,
): ActivityHistoryIdentity {
  return {
    activityId: dependencies.ids.generate(),
    correlationId,
    featurePlanId: binding.featurePlanId,
    taskId: binding.taskId,
    timestamp: dependencies.clock.now().toISOString(),
  };
}

function readOptionalPriorSummary(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const summary = Reflect.get(value, 'priorRequestSummary');
  return typeof summary === 'string' ? summary : undefined;
}

function buildVerifiedCompletedWorkSummary(
  planSummary: ReturnType<typeof summarizeChangePlan>,
): string {
  const parts: string[] = [];
  if (planSummary.createdCount > 0) parts.push(`${planSummary.createdCount} created`);
  if (planSummary.updatedCount > 0) parts.push(`${planSummary.updatedCount} updated`);
  if (planSummary.deletedCount > 0) parts.push(`${planSummary.deletedCount} deleted`);
  const action = parts.length > 0 ? parts.join(', ') : 'Verified change applied';
  const topPaths = planSummary.affectedPaths.slice(0, 3).join(', ');
  const summary =
    topPaths.length > 0 ? `${action}: ${topPaths}` : `${action} with no affected paths recorded.`;
  return summary.slice(0, 1_000);
}

function defaultTrustedLocalSecurity(): WorkspaceSecurityConfiguration {
  return {
    profile: 'TRUSTED_LOCAL',
    projectId: 'builder-ai',
    principalId: 'local-operator',
  };
}
