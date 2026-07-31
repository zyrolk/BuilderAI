import {
  AI_PROVIDER_CONTRACT_VERSION,
  ProviderContractViolationError,
  type AIProviderRequest,
  type AIProviderResponse,
  type ProviderJsonValue,
  type ProviderMetadata,
} from '../../../core/ai-provider';
import type { PromptOutputContractSection } from '../../../core/prompt-orchestrator';
import { type GeminiClock, type GeminiGenerateContentRequest } from '../types';
import { GeminiRawResponseValidator, GeminiStructuredOutputValidator } from '../validators';

export class GeminiResponseMapper {
  private readonly rawValidator: GeminiRawResponseValidator = new GeminiRawResponseValidator();
  private readonly outputValidator: GeminiStructuredOutputValidator =
    new GeminiStructuredOutputValidator();

  constructor(private readonly clock: GeminiClock) {}

  map(
    raw: unknown,
    request: AIProviderRequest,
    providerRequest: GeminiGenerateContentRequest,
    startedAt: string,
  ): AIProviderResponse {
    const response = this.rawValidator.parse(raw);
    const structuredOutput = parseJson(response.text);
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
        id: 'gemini-text',
        name: 'Gemini response text',
        kind: 'TEXT' as const,
        content: response.text,
      },
      {
        id: 'gemini-structured',
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
        inputCharacters: providerRequest.contents.length,
        promptCharacters: request.prompt.budget.characters,
        outputCharacters: response.text.length,
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
      { path: '$.text', message: 'must contain valid JSON' },
    ]);
  }
}

function createMetadata(
  response: ReturnType<GeminiRawResponseValidator['parse']>,
): ProviderMetadata {
  return {
    ...(response.responseId === undefined ? {} : { 'gemini-response-id': response.responseId }),
    ...(response.modelVersion === undefined
      ? {}
      : { 'gemini-model-version': response.modelVersion }),
    'finish-reason': response.finishReason,
    'input-tokens': response.usage.inputTokens,
    'output-tokens': response.usage.outputTokens,
    'total-tokens': response.usage.totalTokens,
  };
}
