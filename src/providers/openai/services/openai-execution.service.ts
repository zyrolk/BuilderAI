import {
  AIProviderError,
  InvalidProviderConfigurationError,
  ProviderContractViolationError,
  type AIProvider,
  type AIProviderErrorCode,
  type AIProviderResponse,
} from '../../../core/ai-provider';
import {
  ExecutionEngineService,
  ExecutionResultService,
  TimeoutPolicyService,
  type ExecutionArtifactPlaceholder,
  type ExecutionCancellationToken,
  type ExecutionFailure,
  type ExecutionRequest,
  type ExecutionSnapshot,
} from '../../../core/execution-engine';
import { TruncationRetryCompactionService } from '../../../core/prompt-orchestrator';
import { OpenAIExecutionRequestMapper } from '../mapper';
import {
  OPENAI_PROVIDER_ID,
  type OpenAIClock,
  type OpenAIExecutionOutput,
  type OpenAIProviderConfiguration,
} from '../types';
import { OpenAIConfigurationValidator } from '../validators';

/**
 * PROVIDER_UNAVAILABLE and OUTPUT_TRUNCATED are transient, retryable failures at
 * launch (P1-5 / ADR-019, ADR-026). TIMEOUT, CONTRACT_VIOLATION,
 * INVALID_CONFIGURATION, CANCELLED, and UNSUPPORTED_CAPABILITY are never retried.
 */
const RETRYABLE_PROVIDER_ERROR_CODES: ReadonlySet<AIProviderErrorCode> = new Set([
  'OUTPUT_TRUNCATED',
  'PROVIDER_UNAVAILABLE',
]);

export class OpenAIExecutionService {
  private readonly engine = new ExecutionEngineService();
  private readonly resultService = new ExecutionResultService();
  private readonly requestMapper = new OpenAIExecutionRequestMapper();
  private readonly timeoutPolicy = new TimeoutPolicyService();
  private readonly compaction = new TruncationRetryCompactionService();

  constructor(
    private readonly provider: AIProvider,
    private readonly configuration: OpenAIProviderConfiguration,
    private readonly clock: OpenAIClock = systemClock,
  ) {
    const validator: OpenAIConfigurationValidator = new OpenAIConfigurationValidator();
    validator.validate(configuration);
    if (provider.descriptor.id !== OPENAI_PROVIDER_ID) {
      throw new InvalidProviderConfigurationError([
        {
          path: '$.provider.descriptor.id',
          message: `must equal '${OPENAI_PROVIDER_ID}'`,
        },
      ]);
    }
  }

  async execute(request: ExecutionRequest): Promise<OpenAIExecutionOutput> {
    let snapshot = this.engine.create(request);
    snapshot = this.engine.markValidated(snapshot, this.clock());
    snapshot = this.engine.enqueue(snapshot, this.clock());
    let priorFailureCode: AIProviderErrorCode | undefined;

    for (;;) {
      snapshot = this.engine.beginPreparation(snapshot, this.clock());
      snapshot = this.engine.markReady(snapshot, this.clock());
      const reservedAt = this.clock();
      snapshot = this.engine.reserveExecution(snapshot, reservedAt);

      const attemptResolution = this.compaction.resolveAttempt({
        prompt: request.prompt,
        attempt: snapshot.attempt,
        priorFailureCode,
      });
      const providerRequest = this.requestMapper.map(
        request,
        this.configuration,
        snapshot.attempt,
        this.attemptTimeoutMs(request, snapshot, reservedAt),
        attemptResolution,
      );

      let providerResponse: AIProviderResponse;
      try {
        providerResponse = await this.provider.execute(providerRequest);
      } catch (error: unknown) {
        if (error instanceof AIProviderError) priorFailureCode = error.code;
        const next = await this.handleFailure(request, snapshot, error);
        if (next === undefined) throw error;
        snapshot = next;
        continue;
      }

      snapshot = this.engine.complete(snapshot, this.clock());
      const executionResult = this.resultService.create(snapshot, {
        diagnostics: providerResponse.diagnostics,
        usage: {
          promptCharacters: providerResponse.usage.promptCharacters,
          outputCharacters: providerResponse.usage.outputCharacters,
          estimated: false,
        },
        artifacts: providerResponse.artifacts.map<ExecutionArtifactPlaceholder>((artifact) => ({
          id: artifact.id,
          name: artifact.name,
          kind: artifact.kind,
          state: 'PLACEHOLDER',
        })),
        metadata: providerResponse.metadata,
      });
      const artifact = providerResponse.artifacts.find(
        (candidate) => candidate.kind === 'STRUCTURED_DATA',
      );
      if (artifact?.kind !== 'STRUCTURED_DATA') {
        throw new ProviderContractViolationError('RESPONSE', [
          { path: '$.artifacts', message: 'is missing validated structured output' },
        ]);
      }
      this.compaction.validateStructuredOutput(artifact.data, attemptResolution);
      return {
        providerResponse,
        executionResult,
        structuredOutput: artifact.data,
      };
    }
  }

  /**
   * Decides whether a failed attempt should be retried. Returns the snapshot
   * to resume the loop from (now QUEUED) when a retry should proceed, or
   * `undefined` once the snapshot has reached a terminal state (FAILED or
   * TIMED_OUT) and the caller must rethrow the original provider error.
   */
  private async handleFailure(
    request: ExecutionRequest,
    snapshot: ExecutionSnapshot,
    error: unknown,
  ): Promise<ExecutionSnapshot | undefined> {
    const failure = toExecutionFailure(error);
    const { snapshot: decided, decision } = this.engine.retry(
      request,
      snapshot,
      failure,
      this.clock(),
    );
    if (!decision.shouldRetry) {
      this.engine.fail(decided, failure, this.clock());
      return undefined;
    }
    const cancelledDuringDelay = await waitForRetryDelay(decision.delayMs, request.cancellation);
    if (cancelledDuringDelay) {
      this.engine.fail(decided, failure, this.clock());
      return undefined;
    }
    const retryReadyAt = this.clock();
    if (this.timeoutPolicy.assess(request.policy.timeout, decided, retryReadyAt).timedOut) {
      this.engine.markTimedOut(request, decided, retryReadyAt);
      return undefined;
    }
    return decided;
  }

  /**
   * Caps every provider attempt to the execution's single remaining timeout
   * budget so a retry can never grant a fresh full timeout that multiplies
   * total request latency (P1-5 / ADR-019).
   */
  private attemptTimeoutMs(
    request: ExecutionRequest,
    snapshot: ExecutionSnapshot,
    evaluatedAt: string,
  ): number {
    const assessment = this.timeoutPolicy.assess(request.policy.timeout, snapshot, evaluatedAt);
    return Math.max(1, Math.min(assessment.remainingMs, this.configuration.maximumTimeoutMs));
  }
}

function toExecutionFailure(error: unknown): ExecutionFailure {
  if (error instanceof AIProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: RETRYABLE_PROVIDER_ERROR_CODES.has(error.code),
    };
  }
  return {
    code: 'UNKNOWN_PROVIDER_ERROR',
    message: error instanceof Error ? error.message : 'Unknown provider failure.',
    retryable: false,
  };
}

/**
 * Waits out the retry delay while staying responsive to cancellation.
 * Resolves `true` (and skips the second provider call) if cancellation is
 * observed before or during the wait.
 */
function waitForRetryDelay(
  delayMs: number,
  cancellation: ExecutionCancellationToken,
): Promise<boolean> {
  if (cancellation.cancelled) return Promise.resolve(true);
  if (delayMs <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(false);
    }, delayMs);
    unsubscribe = cancellation.subscribe(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function systemClock(): string {
  return new Date().toISOString();
}
