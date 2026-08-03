import {
  AI_PROVIDER_CONTRACT_VERSION,
  ProviderContractViolationError,
  type AIProviderRequest,
  type AIProviderResponse,
  type ProviderJsonValue,
  type ProviderMetadata,
} from '../../../core/ai-provider';
import type { PromptOutputContractSection } from '../../../core/prompt-orchestrator';
import {
  OPENROUTER_PROVIDER_ID,
  type OpenRouterChatCompletionRequest,
  type OpenRouterClock,
} from '../types';
import { OpenRouterRawResponseValidator, OpenRouterStructuredOutputValidator } from '../validators';

export class OpenRouterResponseMapper {
  private readonly rawValidator = new OpenRouterRawResponseValidator();
  private readonly outputValidator: OpenRouterStructuredOutputValidator =
    new OpenRouterStructuredOutputValidator();

  constructor(private readonly clock: OpenRouterClock) {}

  map(
    raw: unknown,
    request: AIProviderRequest,
    providerRequest: OpenRouterChatCompletionRequest,
    startedAt: string,
  ): AIProviderResponse {
    const response = this.rawValidator.parse(raw);
    const structuredOutput = parseJson(response.content);
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
        id: 'openrouter-text',
        name: 'OpenRouter response text',
        kind: 'TEXT' as const,
        content: response.content,
      },
      {
        id: 'openrouter-structured',
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
        inputCharacters: providerRequest.messages[0].content.length,
        promptCharacters: request.prompt.budget.characters,
        outputCharacters: response.content.length,
        artifactCount: artifacts.length,
      },
      metadata: createMetadata(response),
    };
  }
}

function parseJson(value: string): ProviderJsonValue {
  try {
    return JSON.parse(value) as ProviderJsonValue;
  } catch {
    throw new ProviderContractViolationError('RESPONSE', [
      { path: '$.choices[0].message.content', message: 'must contain valid JSON' },
    ]);
  }
}

function createMetadata(
  response: ReturnType<OpenRouterRawResponseValidator['parse']>,
): ProviderMetadata {
  return {
    'openrouter-response-id': response.id,
    'openrouter-model': response.model,
    'finish-reason': response.finishReason,
    'input-tokens': response.usage.inputTokens,
    'output-tokens': response.usage.outputTokens,
    'total-tokens': response.usage.totalTokens,
    'provider-id': OPENROUTER_PROVIDER_ID,
  };
}
