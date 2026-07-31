import type { BlueprintReaderService } from '../../core/blueprint-reader';
import type { ChangePlannerService } from '../../core/change-planner';
import type { ContextBuilderService, ProjectFileSource } from '../../core/context-builder';
import type { ExecutionCancellationToken } from '../../core/execution-engine';
import type { ExecutionRequest } from '../../core/execution-engine';
import type { FileApplyEngineService } from '../../core/file-apply';
import { parseProjectBrain, type ProjectBrain, type ProjectTask } from '../../core/project-brain';
import type { PromptOrchestratorService } from '../../core/prompt-orchestrator';
import type { ResponseProcessorService } from '../../core/response-processor';
import type { VerificationEngineService } from '../../core/verification';
import { InMemoryPreparationStore } from './in-memory-preparation.store';
import {
  DEFAULT_WORKSPACE_RUNTIME_CONFIGURATION,
  WorkspaceRuntimeError,
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
  readonly blueprintReader: BlueprintReaderService;
  readonly sourceFiles: ProjectFileSource;
  readonly contextBuilder: ContextBuilderService;
  readonly promptOrchestrator: PromptOrchestratorService;
  readonly providerExecution: ProviderExecutionPort;
  readonly responseProcessor: ResponseProcessorService;
  readonly changePlanner: ChangePlannerService;
  readonly fileApply: FileApplyEngineService;
  readonly verification: VerificationEngineService;
  readonly clock: WorkspaceRuntimeClock;
  readonly ids: WorkspaceRuntimeIdGenerator;
  readonly logger: WorkspaceRuntimeLogger;
  readonly configuration?: WorkspaceRuntimeConfiguration;
}

export class WorkspaceRuntimeService {
  private readonly configuration: WorkspaceRuntimeConfiguration;
  private readonly store: InMemoryPreparationStore;

  constructor(private readonly dependencies: WorkspaceRuntimeDependencies) {
    this.configuration = dependencies.configuration ?? DEFAULT_WORKSPACE_RUNTIME_CONFIGURATION;
    validateConfiguration(this.configuration);
    this.store = new InMemoryPreparationStore(
      dependencies.clock,
      this.configuration.maximumPreparations,
    );
  }

  async prepare(request: string): Promise<WorkspacePreparation> {
    const normalizedRequest = validateRequest(request);
    const correlationId = this.dependencies.ids.generate();
    const startedAt = this.dependencies.clock.now();
    this.log(correlationId, 'PREPARE', 'STARTED');
    try {
      const canonicalBrain = this.dependencies.loadProjectBrain();
      const readerOutput = await this.dependencies.blueprintReader.read();
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
      const executionBrain = createExecutionBrain(canonicalBrain, transientTask);
      const context = await this.dependencies.contextBuilder.build({
        projectBrain: executionBrain,
        blueprintReaderOutput: readerOutput,
        currentTaskId: transientTask.id,
        sourceFileSource: this.dependencies.sourceFiles,
      });
      const prompt = await this.dependencies.promptOrchestrator.build({
        context,
        metadata: { 'correlation-id': correlationId, source: 'workspace' },
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
      const changePlan = this.dependencies.changePlanner.plan(responsePackage);
      const expiresAt = new Date(startedAt.getTime() + this.configuration.preparationTtlMs);
      this.store.save(correlationId, changePlan, expiresAt);
      this.log(correlationId, 'PREPARE', 'SUCCEEDED', startedAt);
      return {
        preparationId: correlationId,
        expiresAt: expiresAt.toISOString(),
        responsePackage,
        changePlan,
      };
    } catch (error: unknown) {
      this.log(correlationId, 'PREPARE', 'FAILED', startedAt, safeCode(error));
      throw error;
    }
  }

  async approveAndApply(preparationId: string, approved: boolean): Promise<WorkspaceCompletion> {
    if (!approved) {
      throw new WorkspaceRuntimeError('APPROVAL_REQUIRED', 'Explicit approval is required.');
    }
    if (!isIdentifier(preparationId)) {
      throw new WorkspaceRuntimeError('INVALID_REQUEST', 'Preparation identifier is invalid.');
    }
    const startedAt = this.dependencies.clock.now();
    this.log(preparationId, 'APPLY_AND_VERIFY', 'STARTED');
    const claim = this.store.claim(preparationId);
    if (claim.kind === 'COMPLETED') return claim.completion;
    try {
      const applyResult = await this.dependencies.fileApply.apply(claim.plan);
      const completion: WorkspaceCompletion =
        applyResult.status === 'APPLIED'
          ? {
              applyResult,
              verificationReport: await this.dependencies.verification.verify(applyResult),
            }
          : { applyResult };
      this.store.complete(preparationId, completion);
      this.log(preparationId, 'APPLY_AND_VERIFY', 'SUCCEEDED', startedAt);
      return structuredClone(completion);
    } catch (error: unknown) {
      this.store.fail(preparationId);
      this.log(preparationId, 'APPLY_AND_VERIFY', 'FAILED', startedAt, safeCode(error));
      throw error;
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

function createExecutionBrain(brain: ProjectBrain, task: ProjectTask): ProjectBrain {
  return parseProjectBrain({ ...brain, tasks: [...brain.tasks, task] });
}

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
      failureStrategy: 'FAIL_FAST',
      retry: {
        maximumRetries: 0,
        delayStrategy: 'NONE',
        baseDelayMs: 0,
        maximumDelayMs: 0,
        retryableErrorCodes: [],
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

function safeCode(error: unknown): string {
  if (error instanceof WorkspaceRuntimeError) return error.code;
  if (typeof error === 'object' && error !== null) {
    const code = Reflect.get(error, 'code');
    if (typeof code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(code)) return code;
  }
  return 'WORKFLOW_FAILED';
}
