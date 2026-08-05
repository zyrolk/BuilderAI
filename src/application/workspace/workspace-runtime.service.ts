import type { ProjectContextReaderPort } from '../../core/target-project';
import { ExternalTargetOnboardingError } from '../../core/target-project';
import type { ChangePlannerService } from '../../core/change-planner';
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
import type {
  PromptIterationContent,
  PromptOrchestratorService,
  PromptPackage,
} from '../../core/prompt-orchestrator';
import type { ResponseProcessorService } from '../../core/response-processor';
import { PrepareScopeService, type UpdateScopePlan } from '../../core/update-scope';
import type { ContextPackage } from '../../core/context-builder';
import type { VerificationEngineService, VerificationReport } from '../../core/verification';
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
  readonly verification: VerificationEngineService;
  readonly clock: WorkspaceRuntimeClock;
  readonly ids: WorkspaceRuntimeIdGenerator;
  readonly logger: WorkspaceRuntimeLogger;
  readonly activityHistory?: ActivityHistoryService;
  readonly configuration?: WorkspaceRuntimeConfiguration;
  readonly prepareScope?: PrepareScopeService;
  readonly security?: WorkspaceSecurityConfiguration;
  readonly projectRoot?: string;
  readonly applyLock?: WorkspaceApplyLockService;
}

export class WorkspaceRuntimeService {
  private readonly configuration: WorkspaceRuntimeConfiguration;
  private readonly store: InMemoryPreparationStore;
  private readonly prepareScope: PrepareScopeService;
  private readonly security: WorkspaceSecurityConfiguration;
  private readonly authorization: WorkspaceAuthorizationService;
  private readonly applyLock: WorkspaceApplyLockService;
  private readonly applyPolicy: WorkspaceApplyPolicyService;
  private readonly applyAudit?: WorkspaceApplyAuditService;

  constructor(private readonly dependencies: WorkspaceRuntimeDependencies) {
    this.configuration = dependencies.configuration ?? DEFAULT_WORKSPACE_RUNTIME_CONFIGURATION;
    validateConfiguration(this.configuration);
    this.store = new InMemoryPreparationStore(
      dependencies.clock,
      this.configuration.maximumPreparations,
    );
    this.prepareScope = dependencies.prepareScope ?? new PrepareScopeService();
    this.security = dependencies.security ?? defaultTrustedLocalSecurity();
    this.authorization = new WorkspaceAuthorizationService(this.security);
    this.applyLock = dependencies.applyLock ?? new WorkspaceApplyLockService();
    this.applyPolicy = new WorkspaceApplyPolicyService();
    this.applyAudit =
      dependencies.projectRoot === undefined
        ? undefined
        : new WorkspaceApplyAuditService({ projectRoot: dependencies.projectRoot });
  }

  async prepare(request: string, iterationFeedbackInput?: unknown): Promise<WorkspacePreparation> {
    const normalizedRequest = validateRequest(request);
    const normalizedFeedback =
      iterationFeedbackInput === undefined
        ? undefined
        : normalizeIterationFeedback(iterationFeedbackInput, {
            priorRequestSummary: readOptionalPriorSummary(iterationFeedbackInput),
          });
    const iterationPathHints =
      normalizedFeedback === undefined ? [] : extractIterationPathHints(normalizedFeedback);
    const correlationId = this.dependencies.ids.generate();
    const startedAt = this.dependencies.clock.now();
    this.log(correlationId, 'PREPARE', 'STARTED');
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
      const transientTask = createTransientTask(correlationId, normalizedRequest, requestedAt);
      const executionBrain = createExecutionBrain(canonicalBrain, [transientTask]);
      const { prompt, scopePlan } = await this.buildScopedPrepareArtifacts({
        taskText: normalizedRequest,
        executionBrain,
        readerOutput,
        currentTaskId: transientTask.id,
        iterationPathHints,
        correlationId,
        metadata: { 'correlation-id': correlationId, source: 'workspace' },
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
      const expiresAt = new Date(startedAt.getTime() + this.configuration.preparationTtlMs);
      const applyAuthorizationToken = this.issueApplyAuthorizationToken();
      this.store.save(correlationId, changePlan, expiresAt, undefined, applyAuthorizationToken);
      this.log(correlationId, 'PREPARE', 'SUCCEEDED', startedAt);
      return {
        preparationId: correlationId,
        expiresAt: expiresAt.toISOString(),
        responsePackage,
        changePlan,
        ...(applyAuthorizationToken === undefined ? {} : { applyAuthorizationToken }),
      };
    } catch (error: unknown) {
      this.log(correlationId, 'PREPARE', 'FAILED', startedAt, safeCode(error));
      throw error;
    }
  }

  async prepareFeatureTask(input: FeatureTaskPrepareInput): Promise<WorkspacePreparation> {
    const taskRequest =
      input.request.trim().length > 0 ? input.request.trim() : buildFeatureTaskRequest(input.task);
    const normalizedRequest = validateRequest(taskRequest);
    const normalizedFeedback = input.iterationFeedback;
    const iterationPathHints = mergePathHints(
      input.task.expectedAreas,
      input.iterationPathHints ?? [],
      normalizedFeedback === undefined ? [] : extractIterationPathHints(normalizedFeedback),
    );
    const correlationId = this.dependencies.ids.generate();
    const startedAt = this.dependencies.clock.now();
    const featureBinding: FeatureTaskPreparationBinding = {
      featurePlanId: input.plan.featurePlanId,
      taskId: input.task.taskId,
    };
    this.log(correlationId, 'PREPARE_FEATURE_TASK', 'STARTED');
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
      const expiresAt = new Date(startedAt.getTime() + this.configuration.preparationTtlMs);
      const applyAuthorizationToken = this.issueApplyAuthorizationToken();
      this.store.save(
        correlationId,
        changePlan,
        expiresAt,
        featureBinding,
        applyAuthorizationToken,
      );
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

  async approveAndApply(
    preparationId: string,
    approved: boolean,
    evidence?: WorkspaceRequestSecurityEvidence,
  ): Promise<WorkspaceCompletion> {
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

    const startedAt = this.dependencies.clock.now();
    this.log(preparationId, 'APPLY_AND_VERIFY', 'STARTED');
    const claim = this.store.claim(preparationId);
    if (claim.kind === 'COMPLETED') return claim.completion;

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
        applyResult = await this.dependencies.fileApply.apply(claim.plan);
      } catch (applyError: unknown) {
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
          verificationReport = await this.dependencies.verification.verify(applyResult);
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
      const completion: WorkspaceCompletion =
        verificationReport === undefined ? { applyResult } : { applyResult, verificationReport };
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
      this.log(preparationId, 'APPLY_AND_VERIFY', 'SUCCEEDED', startedAt);
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
    }
  }

  private issueApplyAuthorizationToken(): string | undefined {
    if (this.security.profile !== 'PROTECTED') return undefined;
    return this.dependencies.ids.generate();
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
  }): Promise<{
    readonly context: ContextPackage;
    readonly prompt: PromptPackage;
    readonly scopePlan: UpdateScopePlan;
  }> {
    const sourcePaths = await this.dependencies.sourceFiles.listSourcePaths();
    const scopeResolution = this.prepareScope.resolve({
      taskText: input.taskText,
      sourcePaths,
      ...(input.iterationPathHints.length === 0
        ? {}
        : { iterationPathHints: input.iterationPathHints }),
      baselinePort: this.dependencies.workspaceBaseline,
    });
    const context = await this.dependencies.contextBuilder.build({
      projectBrain: input.executionBrain,
      blueprintReaderOutput: input.readerOutput,
      currentTaskId: input.currentTaskId,
      sourceFileSource: this.dependencies.sourceFiles,
      ...(input.iterationPathHints.length === 0
        ? {}
        : { iterationPathHints: input.iterationPathHints }),
      ...(scopeResolution.pinnedBaselineFiles.length === 0
        ? {}
        : { pinnedBaselineFiles: scopeResolution.pinnedBaselineFiles }),
    });
    const prompt = await this.dependencies.promptOrchestrator.build({
      context,
      metadata: input.metadata,
      ...(input.iterationFeedback === undefined
        ? {}
        : { iterationFeedback: input.iterationFeedback }),
      ...(scopeResolution.preservationContract === undefined
        ? {}
        : { preservationContract: scopeResolution.preservationContract }),
    });
    return { context, prompt, scopePlan: scopeResolution.scopePlan };
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
 * Bounded retry policy for transient provider outages (P1-5 / ADR-019).
 * Exactly one retry (two total provider attempts) is permitted, and only for
 * PROVIDER_UNAVAILABLE failures. The delay is a small deterministic fixed
 * amount; the Execution Engine remains the sole retry-policy decision owner
 * and caps every attempt to the single overall timeout budget below.
 */
const RETRY_DELAY_MS = 300;

function createExecutionRequest(
  executionId: string,
  prompt: ExecutionRequest['prompt'],
  requestedAt: string,
  timeoutMs: number,
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
        maximumRetries: 1,
        delayStrategy: 'FIXED',
        baseDelayMs: RETRY_DELAY_MS,
        maximumDelayMs: RETRY_DELAY_MS,
        retryableErrorCodes: ['OUTPUT_TRUNCATED', 'PROVIDER_UNAVAILABLE'],
      },
      timeout: { durationMs: timeoutMs, startsAt: 'QUEUED' },
    },
    cancellation: neverCancelled(),
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

function defaultTrustedLocalSecurity(): WorkspaceSecurityConfiguration {
  return {
    profile: 'TRUSTED_LOCAL',
    projectId: 'builder-ai',
    principalId: 'local-operator',
  };
}
