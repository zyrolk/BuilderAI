import {
  InvalidProviderConfigurationError,
  ProviderContractViolationError,
  type AIProvider,
  type AIProviderResponse,
  type ProviderJsonValue,
} from '../../../core/ai-provider';
import {
  CoordinatorProviderExecutionService,
  type CoordinatorProviderRoute,
} from '../../../core/ai-provider/services/coordinator-provider-execution.service';
import type {
  ProviderCoordinatorLogger,
  SleepFunction,
} from '../../../core/ai-provider/services/provider-coordinator';
import type { ExecutionRequest } from '../../../core/execution-engine';
import { GeminiExecutionRequestMapper } from '../mapper';
import {
  GEMINI_PROVIDER_ID,
  type GeminiClock,
  type GeminiExecutionAttemptLogger,
  type GeminiExecutionOutput,
  type GeminiProviderConfiguration,
} from '../types';
import { GeminiConfigurationValidator } from '../validators';

export function createGeminiCoordinatorRoute(
  provider: AIProvider,
  configuration: GeminiProviderConfiguration,
  mapper: GeminiExecutionRequestMapper = new GeminiExecutionRequestMapper(),
): CoordinatorProviderRoute {
  return {
    providerId: provider.descriptor.id,
    provider,
    mapRequest: (request, attempt, timeoutMs, resolution) =>
      mapper.map(request, configuration, attempt, timeoutMs, resolution),
  };
}

/**
 * Gemini provider execution via ProviderCoordinator. Retry, backoff, fallback,
 * and cancellation are owned by the coordinator — this service performs no
 * independent retry loop.
 */
export class GeminiExecutionService {
  private readonly coordinated: CoordinatorProviderExecutionService;
  private readonly correlationRef = { id: '' };

  constructor(
    provider: AIProvider,
    configuration: GeminiProviderConfiguration,
    clock: GeminiClock = systemClock,
    attemptLogger?: GeminiExecutionAttemptLogger,
    sleep?: SleepFunction,
  ) {
    const validator: GeminiConfigurationValidator = new GeminiConfigurationValidator();
    validator.validate(configuration);
    if (provider.descriptor.id !== GEMINI_PROVIDER_ID) {
      throw new InvalidProviderConfigurationError([
        { path: '$.provider.descriptor.id', message: `must equal '${GEMINI_PROVIDER_ID}'` },
      ]);
    }
    this.coordinated = new CoordinatorProviderExecutionService(
      { routes: [createGeminiCoordinatorRoute(provider, configuration)] },
      clock,
      attemptLogger === undefined
        ? undefined
        : mapAttemptLogger(attemptLogger, this.correlationRef),
      sleep,
    );
  }

  async execute(request: ExecutionRequest): Promise<GeminiExecutionOutput> {
    this.correlationRef.id = request.metadata.correlationId;
    const output = await this.coordinated.execute(request);
    const structuredOutput = extractStructuredOutput(output.providerResponse);
    return {
      providerResponse: output.providerResponse,
      executionResult: output.executionResult,
      structuredOutput,
    };
  }
}

function extractStructuredOutput(providerResponse: AIProviderResponse): ProviderJsonValue {
  const artifact = providerResponse.artifacts.find(
    (candidate) => candidate.kind === 'STRUCTURED_DATA',
  );
  if (artifact?.kind !== 'STRUCTURED_DATA') {
    throw new ProviderContractViolationError('RESPONSE', [
      { path: '$.artifacts', message: 'is missing validated structured output' },
    ]);
  }
  return artifact.data;
}

function mapAttemptLogger(
  logger: GeminiExecutionAttemptLogger,
  correlationRef: { id: string },
): ProviderCoordinatorLogger {
  return {
    recordAttempt: (diagnostics) => {
      logger.recordAttempt({
        correlationId: correlationRef.id,
        attempt: diagnostics.attempt,
        durationMs: diagnostics.elapsedMs,
        outcome: 'FAILED',
        errorCode: diagnostics.errorCode,
        retryAfterMs: diagnostics.retryAfterMs,
        boundingActive: false,
        compactionActive: false,
        allowlistCount: 0,
        attemptTimeoutMs: diagnostics.remainingMs,
      });
    },
  };
}

function systemClock(): string {
  return new Date().toISOString();
}
