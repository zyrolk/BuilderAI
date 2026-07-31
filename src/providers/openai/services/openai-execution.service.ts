import {
  InvalidProviderConfigurationError,
  ProviderContractViolationError,
  type AIProvider,
} from '../../../core/ai-provider';
import {
  ExecutionEngineService,
  ExecutionResultService,
  type ExecutionArtifactPlaceholder,
  type ExecutionRequest,
} from '../../../core/execution-engine';
import { OpenAIExecutionRequestMapper } from '../mapper';
import {
  OPENAI_PROVIDER_ID,
  type OpenAIClock,
  type OpenAIExecutionOutput,
  type OpenAIProviderConfiguration,
} from '../types';
import { OpenAIConfigurationValidator } from '../validators';

export class OpenAIExecutionService {
  private readonly engine = new ExecutionEngineService();
  private readonly resultService = new ExecutionResultService();
  private readonly requestMapper = new OpenAIExecutionRequestMapper();

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
    snapshot = this.engine.beginPreparation(snapshot, this.clock());
    snapshot = this.engine.markReady(snapshot, this.clock());
    snapshot = this.engine.reserveExecution(snapshot, this.clock());

    const providerRequest = this.requestMapper.map(request, this.configuration, snapshot.attempt);
    const providerResponse = await this.provider.execute(providerRequest);
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
    return {
      providerResponse,
      executionResult,
      structuredOutput: artifact.data,
    };
  }
}

function systemClock(): string {
  return new Date().toISOString();
}
