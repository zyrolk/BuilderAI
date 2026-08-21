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
import type { SleepFunction } from '../../../core/ai-provider/services/provider-coordinator';
import type { ExecutionRequest } from '../../../core/execution-engine';
import { OpenRouterExecutionRequestMapper } from '../mapper';
import {
  OPENROUTER_PROVIDER_ID,
  type OpenRouterClock,
  type OpenRouterExecutionOutput,
  type OpenRouterProviderConfiguration,
} from '../types';
import { OpenRouterConfigurationValidator } from '../validators';

export function createOpenRouterCoordinatorRoute(
  provider: AIProvider,
  configuration: OpenRouterProviderConfiguration,
  mapper: OpenRouterExecutionRequestMapper = new OpenRouterExecutionRequestMapper(),
): CoordinatorProviderRoute {
  return {
    providerId: provider.descriptor.id,
    provider,
    mapRequest: (request, attempt, timeoutMs, resolution) =>
      mapper.map(request, configuration, attempt, timeoutMs, resolution),
  };
}

/**
 * OpenRouter provider execution via ProviderCoordinator. No independent retry loop.
 */
export class OpenRouterExecutionService {
  private readonly coordinated: CoordinatorProviderExecutionService;

  constructor(
    provider: AIProvider,
    configuration: OpenRouterProviderConfiguration,
    clock: OpenRouterClock = systemClock,
    sleep?: SleepFunction,
  ) {
    const validator: OpenRouterConfigurationValidator = new OpenRouterConfigurationValidator();
    validator.validate(configuration);
    if (provider.descriptor.id !== OPENROUTER_PROVIDER_ID) {
      throw new InvalidProviderConfigurationError([
        {
          path: '$.provider.descriptor.id',
          message: `must equal '${OPENROUTER_PROVIDER_ID}'`,
        },
      ]);
    }
    this.coordinated = new CoordinatorProviderExecutionService(
      { routes: [createOpenRouterCoordinatorRoute(provider, configuration)] },
      clock,
      undefined,
      sleep,
    );
  }

  async execute(request: ExecutionRequest): Promise<OpenRouterExecutionOutput> {
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

function systemClock(): string {
  return new Date().toISOString();
}
