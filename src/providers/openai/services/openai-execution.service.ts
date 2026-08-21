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
import { OpenAIExecutionRequestMapper } from '../mapper';
import {
  OPENAI_PROVIDER_ID,
  type OpenAIClock,
  type OpenAIExecutionOutput,
  type OpenAIProviderConfiguration,
} from '../types';
import { OpenAIConfigurationValidator } from '../validators';

export function createOpenAICoordinatorRoute(
  provider: AIProvider,
  configuration: OpenAIProviderConfiguration,
  mapper: OpenAIExecutionRequestMapper = new OpenAIExecutionRequestMapper(),
): CoordinatorProviderRoute {
  return {
    providerId: provider.descriptor.id,
    provider,
    mapRequest: (request, attempt, timeoutMs, resolution) =>
      mapper.map(request, configuration, attempt, timeoutMs, resolution),
  };
}

/**
 * OpenAI provider execution via ProviderCoordinator. No independent retry loop.
 */
export class OpenAIExecutionService {
  private readonly coordinated: CoordinatorProviderExecutionService;

  constructor(
    provider: AIProvider,
    configuration: OpenAIProviderConfiguration,
    clock: OpenAIClock = systemClock,
    sleep?: SleepFunction,
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
    this.coordinated = new CoordinatorProviderExecutionService(
      { routes: [createOpenAICoordinatorRoute(provider, configuration)] },
      clock,
      undefined,
      sleep,
    );
  }

  async execute(request: ExecutionRequest): Promise<OpenAIExecutionOutput> {
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
