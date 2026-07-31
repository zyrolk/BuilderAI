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
import { GeminiExecutionRequestMapper } from '../mapper';
import {
  GEMINI_PROVIDER_ID,
  type GeminiClock,
  type GeminiExecutionOutput,
  type GeminiProviderConfiguration,
} from '../types';
import { GeminiConfigurationValidator } from '../validators';

export class GeminiExecutionService {
  private readonly engine = new ExecutionEngineService();
  private readonly resultService = new ExecutionResultService();
  private readonly requestMapper = new GeminiExecutionRequestMapper();

  constructor(
    private readonly provider: AIProvider,
    private readonly configuration: GeminiProviderConfiguration,
    private readonly clock: GeminiClock = systemClock,
  ) {
    const validator: GeminiConfigurationValidator = new GeminiConfigurationValidator();
    validator.validate(configuration);
    if (provider.descriptor.id !== GEMINI_PROVIDER_ID) {
      throw new InvalidProviderConfigurationError([
        { path: '$.provider.descriptor.id', message: `must equal '${GEMINI_PROVIDER_ID}'` },
      ]);
    }
  }

  async execute(request: ExecutionRequest): Promise<GeminiExecutionOutput> {
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
    return { providerResponse, executionResult, structuredOutput: artifact.data };
  }
}

function systemClock(): string {
  return new Date().toISOString();
}
