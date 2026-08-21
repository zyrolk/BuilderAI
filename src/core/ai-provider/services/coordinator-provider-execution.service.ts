import {
  ExecutionEngineService,
  ExecutionResultService,
  type ExecutionArtifactPlaceholder,
  type ExecutionCancellationToken,
  type ExecutionRequest,
  type ExecutionResult,
} from '../../execution-engine';
import {
  TruncationRetryCompactionService,
  type TruncationRetryAttemptResolution,
} from '../../prompt-orchestrator';
import type { AIProvider } from '../ports/ai-provider';
import type {
  AIProviderRequest,
  AIProviderResponse,
  ProviderCancellationSignal,
} from '../types/ai-provider';
import type { AIProviderErrorCode } from '../types/ai-provider-error';
import { AIProviderError, ProviderContractViolationError } from '../types/ai-provider-error';
import {
  ProviderCoordinator,
  type ProviderCoordinatorLogger,
  type SleepFunction,
} from './provider-coordinator';
import {
  DEFAULT_PROVIDER_RETRY_CONFIGURATION,
  type ProviderRetryConfiguration,
} from './provider-retry-policy';

export interface CoordinatorProviderRoute {
  readonly providerId: string;
  readonly provider: AIProvider;
  readonly mapRequest: (
    request: ExecutionRequest,
    attempt: number,
    attemptTimeoutMs: number,
    resolution: TruncationRetryAttemptResolution,
  ) => AIProviderRequest;
}

export interface CoordinatorProviderExecutionConfiguration {
  readonly routes: readonly CoordinatorProviderRoute[];
  readonly retry?: Partial<ProviderRetryConfiguration>;
  readonly deadlineAnchorMs?: number;
}

export interface CoordinatedProviderExecutionResult {
  readonly providerResponse: AIProviderResponse;
  readonly executionResult: ExecutionResult;
}

/**
 * Production provider execution path: ProviderCoordinator owns retry, backoff,
 * Retry-After, deadline, fallback, cancellation, and attempt diagnostics.
 * Provider routes perform exactly one SDK/API call per coordinator attempt.
 */
export class CoordinatorProviderExecutionService {
  private readonly routes: readonly CoordinatorProviderRoute[];
  private readonly retryDefaults: Partial<ProviderRetryConfiguration>;
  private readonly deadlineAnchorMs?: number;
  private readonly compaction = new TruncationRetryCompactionService();
  private readonly engine = new ExecutionEngineService();
  private readonly resultService = new ExecutionResultService();

  constructor(
    configuration: CoordinatorProviderExecutionConfiguration,
    private readonly clock: () => string = systemClock,
    private readonly logger?: ProviderCoordinatorLogger,
    private readonly sleep?: SleepFunction,
  ) {
    if (configuration.routes.length === 0) {
      throw new Error('At least one coordinator provider route is required.');
    }
    this.routes = configuration.routes;
    this.retryDefaults = configuration.retry ?? {};
    this.deadlineAnchorMs = configuration.deadlineAnchorMs;
  }

  async execute(request: ExecutionRequest): Promise<CoordinatedProviderExecutionResult> {
    let priorFailureCode: AIProviderErrorCode | undefined;
    let attemptNumber = 0;
    let lastResolution: TruncationRetryAttemptResolution = {
      prompt: request.prompt,
      boundingActive: false,
      compactionActive: false,
      allowlist: [],
    };

    const retryConfig: ProviderRetryConfiguration = {
      ...DEFAULT_PROVIDER_RETRY_CONFIGURATION,
      ...this.retryDefaults,
      stageDeadlineMs: request.policy.timeout.durationMs,
      maximumAttempts: request.policy.retry.maximumRetries + 1,
    };

    const routeById = new Map(this.routes.map((route) => [route.providerId, route]));
    const wrappedRoutes = this.routes.map((route) => ({
      providerId: route.providerId,
      provider: {
        descriptor: route.provider.descriptor,
        execute: async (providerRequest: AIProviderRequest): Promise<AIProviderResponse> => {
          try {
            return await route.provider.execute(providerRequest);
          } catch (error: unknown) {
            if (error instanceof AIProviderError) priorFailureCode = error.code;
            throw error;
          }
        },
      } satisfies AIProvider,
    }));

    const startedAt = this.clock();
    let snapshot = this.engine.create(request);
    snapshot = this.engine.markValidated(snapshot, startedAt);
    snapshot = this.engine.enqueue(snapshot, this.clock());
    const queuedTransition = snapshot.history.find((transition) => transition.to === 'QUEUED');
    const deadlineAnchorMs =
      this.deadlineAnchorMs ??
      (queuedTransition === undefined
        ? Date.parse(request.metadata.requestedAt)
        : Date.parse(queuedTransition.occurredAt));

    const coordinator = new ProviderCoordinator(
      {
        routes: wrappedRoutes,
        retry: retryConfig,
        ...(Number.isFinite(deadlineAnchorMs) ? { deadlineAnchorMs } : {}),
      },
      { now: () => Date.parse(this.clock()) },
      this.logger,
      this.sleep,
    );

    snapshot = this.engine.beginPreparation(snapshot, this.clock());
    snapshot = this.engine.markReady(snapshot, this.clock());
    snapshot = this.engine.reserveExecution(snapshot, this.clock());

    const coordination = await coordinator.execute((providerId, timeoutMs) => {
      attemptNumber += 1;
      const route = routeById.get(providerId);
      if (route === undefined) {
        throw new Error(`Unknown provider route '${providerId}'.`);
      }
      lastResolution = this.compaction.resolveAttempt({
        prompt: request.prompt,
        attempt: attemptNumber,
        priorFailureCode,
      });
      return route.mapRequest(request, attemptNumber, timeoutMs, lastResolution);
    }, asProviderCancellationSignal(request.cancellation));

    const providerResponse = coordination.response;
    const artifact = providerResponse.artifacts.find(
      (candidate) => candidate.kind === 'STRUCTURED_DATA',
    );
    if (artifact?.kind !== 'STRUCTURED_DATA') {
      throw new ProviderContractViolationError('RESPONSE', [
        { path: '$.artifacts', message: 'is missing validated structured output' },
      ]);
    }
    this.compaction.validateStructuredOutput(artifact.data, lastResolution);

    snapshot = this.engine.complete(snapshot, this.clock());
    const executionResult = this.resultService.create(snapshot, {
      diagnostics: providerResponse.diagnostics,
      usage: {
        promptCharacters: providerResponse.usage.promptCharacters,
        outputCharacters: providerResponse.usage.outputCharacters,
        estimated: false,
      },
      artifacts: providerResponse.artifacts.map<ExecutionArtifactPlaceholder>((entry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        state: 'PLACEHOLDER',
      })),
      metadata: {
        ...providerResponse.metadata,
        'coordinator-provider-id': coordination.providerId,
        'coordinator-total-attempts': coordination.totalAttempts,
        'coordinator-fallback-used': coordination.fallbackUsed,
      },
    });

    return { providerResponse, executionResult };
  }
}

function asProviderCancellationSignal(
  cancellation: ExecutionCancellationToken,
): ProviderCancellationSignal {
  return cancellation;
}

function systemClock(): string {
  return new Date().toISOString();
}
