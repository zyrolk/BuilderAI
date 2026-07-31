import {
  AI_PROVIDER_CONTRACT_VERSION,
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderUnavailableError,
  type AIProviderRequest,
  type AIProviderResponse,
  type ProviderJsonValue,
} from '../../../core/ai-provider';
import type { PromptOutputContractSection } from '../../../core/prompt-orchestrator';
import { OPENAI_PROVIDER_ID, type OpenAIClock, type OpenAIResponseCreateRequest } from '../types';
import { OpenAIRawResponseValidator, OpenAIStructuredOutputValidator } from '../validators';

export class OpenAIResponseMapper {
  private readonly rawValidator = new OpenAIRawResponseValidator();
  private readonly outputValidator: OpenAIStructuredOutputValidator =
    new OpenAIStructuredOutputValidator();

  constructor(private readonly clock: OpenAIClock) {}

  map(
    raw: unknown,
    request: AIProviderRequest,
    providerRequest: OpenAIResponseCreateRequest,
    startedAt: string,
  ): AIProviderResponse {
    const response = this.rawValidator.parse(raw);
    if (response.status === 'cancelled') {
      throw new ProviderCancelledError(request.requestId);
    }
    if (response.status === 'failed') {
      if (isAvailabilityFailure(response.error?.code)) {
        throw new ProviderUnavailableError(OPENAI_PROVIDER_ID);
      }
      throw new ProviderContractViolationError('RESPONSE', [
        { path: '$.status', message: 'provider returned a failed response' },
      ]);
    }
    if (response.status !== 'completed' || response.usage === null) {
      throw new ProviderContractViolationError('RESPONSE', [
        { path: '$.status', message: 'must be completed for synchronous execution' },
      ]);
    }

    const structuredOutput = parseJson(response.outputText);
    const outputContract = request.prompt.sections.find(
      (section): section is PromptOutputContractSection => section.kind === 'OUTPUT_CONTRACT',
    );
    if (outputContract === undefined) {
      throw new ProviderContractViolationError('REQUEST', [
        { path: '$.prompt.sections', message: 'must contain an output contract section' },
      ]);
    }
    this.outputValidator.validate(structuredOutput, outputContract.expectedOutput);

    const completedAt = this.clock();
    const started = Date.parse(startedAt);
    const completed = Date.parse(completedAt);
    const artifacts = [
      {
        id: 'openai-text',
        name: 'OpenAI response text',
        kind: 'TEXT' as const,
        content: response.outputText,
      },
      {
        id: 'openai-structured',
        name: 'Validated structured response',
        kind: 'STRUCTURED_DATA' as const,
        data: structuredOutput,
      },
    ];
    return {
      contractVersion: AI_PROVIDER_CONTRACT_VERSION,
      requestId: request.requestId,
      status: 'COMPLETED',
      artifacts,
      diagnostics: [],
      warnings: [],
      statistics: {
        startedAt,
        completedAt,
        durationMs:
          Number.isFinite(started) && Number.isFinite(completed) ? completed - started : -1,
      },
      usage: {
        inputCharacters: providerRequest.input.length,
        promptCharacters: request.prompt.budget.characters,
        outputCharacters: response.outputText.length,
        artifactCount: artifacts.length,
      },
      metadata: {
        'openai-response-id': response.id,
        'openai-model': response.model,
        'input-tokens': response.usage.inputTokens,
        'output-tokens': response.usage.outputTokens,
        'total-tokens': response.usage.totalTokens,
      },
    };
  }
}

function parseJson(value: string): ProviderJsonValue {
  try {
    return JSON.parse(value) as ProviderJsonValue;
  } catch {
    throw new ProviderContractViolationError('RESPONSE', [
      { path: '$.output_text', message: 'must contain valid JSON' },
    ]);
  }
}

function isAvailabilityFailure(code: string | undefined): boolean {
  return code === 'server_error' || code === 'rate_limit_exceeded';
}
