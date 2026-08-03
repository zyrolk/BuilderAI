import {
  ProviderContractViolationError,
  type AIProvider,
  type AIProviderRequest,
  type AIProviderResponse,
} from '../../ai-provider';
import { createDescriptor, createResponse } from '../../ai-provider/test/ai-provider.fixture';
import { createExecutionRequest } from '../../execution-engine/test/execution-engine.fixture';
import { OPENAI_PROVIDER_ID } from '../../../providers/openai/types';
import { OpenAIExecutionService } from '../../../providers/openai/services';
import { createGeminiConfiguration } from '../../../providers/gemini/test/gemini-provider.fixture';
import { GEMINI_PROVIDER_ID } from '../../../providers/gemini/types';
import { GeminiExecutionService } from '../../../providers/gemini/services';
import {
  CORRECTION_OUTPUT_BOUNDING_METADATA,
  TruncationRetryCompactionService,
} from '../services/truncation-retry-compaction.service';
import { createCorrectionPromptPackage } from './truncation-retry.fixture';

const SERVICE_PATH = 'src/application/workspace/activity-history.service.ts';
const TEST_PATH = 'src/application/workspace/activity-history.service.test.ts';

function boundedRetryPolicy(durationMs: number) {
  return {
    priority: 'NORMAL' as const,
    validationMode: 'STRICT' as const,
    failureStrategy: 'RETRY_THEN_FAIL' as const,
    retry: {
      maximumRetries: 1,
      delayStrategy: 'FIXED' as const,
      baseDelayMs: 10,
      maximumDelayMs: 10,
      retryableErrorCodes: ['OUTPUT_TRUNCATED', 'PROVIDER_UNAVAILABLE'] as const,
    },
    timeout: { durationMs, startsAt: 'QUEUED' as const },
  };
}

describe('First-attempt correction output bounding', () => {
  const service = new TruncationRetryCompactionService();

  it('validates bounded attempt-1 structured output and rejects out-of-scope paths', async () => {
    const prompt = await createCorrectionPromptPackage({ updated: [SERVICE_PATH, TEST_PATH] });
    const resolution = service.resolveAttempt({ prompt, attempt: 1 });
    expect(resolution.boundingActive).toBe(true);
    expect(resolution.compactionActive).toBe(false);

    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: 'src/application/workspace/activity-history.schemas.ts',
              type: 'TEST',
              content: 'x',
              metadata: { description: 'bad', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [],
        },
        resolution,
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('accepts in-scope bounded attempt-1 structured output', async () => {
    const prompt = await createCorrectionPromptPackage({ updated: [SERVICE_PATH] });
    const resolution = service.resolveAttempt({ prompt, attempt: 1 });

    expect(() =>
      service.validateStructuredOutput(
        {
          summary: 'ok',
          artifacts: [
            {
              logicalPath: SERVICE_PATH,
              type: 'TEST',
              content: 'export {};',
              metadata: { description: 'fix', 'change-operation': 'UPDATE_FILE' },
            },
          ],
          diagnostics: [],
        },
        resolution,
      ),
    ).not.toThrow();
  });

  it('Gemini attempt 1 attaches correction-output-bounding metadata without prompt mutation', async () => {
    class RecordingProvider implements AIProvider {
      readonly calls: AIProviderRequest[] = [];
      readonly descriptor = createDescriptor(GEMINI_PROVIDER_ID);
      async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
        this.calls.push(request);
        return createResponse({
          requestId: 'req',
          artifacts: [
            {
              id: 'a1',
              name: 'structured',
              kind: 'STRUCTURED_DATA',
              data: {
                summary: 'ok',
                artifacts: [
                  {
                    logicalPath: SERVICE_PATH,
                    type: 'TEST',
                    content: 'export {};',
                    metadata: { description: 'fix', 'change-operation': 'UPDATE_FILE' },
                  },
                ],
                diagnostics: [],
              },
            },
          ],
          metadata: { 'finish-reason': 'STOP' },
        });
      }
    }

    const provider = new RecordingProvider();
    const geminiService = new GeminiExecutionService(
      provider,
      createGeminiConfiguration(),
      () => '2026-08-01T00:00:00.000Z',
    );
    const canonicalPrompt = await createCorrectionPromptPackage({
      updated: [SERVICE_PATH, TEST_PATH],
    });
    const request = await createExecutionRequest({
      prompt: canonicalPrompt,
      policy: boundedRetryPolicy(30_000),
    });

    await geminiService.execute(request);

    const call = provider.calls[0];
    expect(call?.prompt).toBe(canonicalPrompt);
    expect(call?.metadata?.[CORRECTION_OUTPUT_BOUNDING_METADATA]).toBe(true);
  });

  it('OpenAI attempt 1 applies post-response bounding validation', async () => {
    class RecordingOpenAIProvider implements AIProvider {
      readonly calls: AIProviderRequest[] = [];
      readonly descriptor = createDescriptor(OPENAI_PROVIDER_ID);
      async execute(request: AIProviderRequest): Promise<AIProviderResponse> {
        this.calls.push(request);
        return createResponse({
          requestId: 'req',
          artifacts: [
            {
              id: 'a1',
              name: 'structured',
              kind: 'STRUCTURED_DATA',
              data: {
                summary: 'ok',
                artifacts: [
                  {
                    logicalPath: 'src/forbidden/extra.ts',
                    type: 'TEST',
                    content: 'x',
                    metadata: { description: 'bad', 'change-operation': 'UPDATE_FILE' },
                  },
                ],
                diagnostics: [],
              },
            },
          ],
        });
      }
    }

    const provider = new RecordingOpenAIProvider();
    const openaiService = new OpenAIExecutionService(provider, {
      model: 'gpt-test',
      defaultTimeoutMs: 1_000,
      maximumTimeoutMs: 30_000,
      maximumInputCharacters: 1_000_000,
      maximumOutputCharacters: 20_000,
      maximumOutputTokens: 2_000,
    });
    const canonicalPrompt = await createCorrectionPromptPackage({ updated: [SERVICE_PATH] });
    const request = await createExecutionRequest({
      prompt: canonicalPrompt,
      policy: boundedRetryPolicy(30_000),
    });

    await expect(openaiService.execute(request)).rejects.toBeInstanceOf(
      ProviderContractViolationError,
    );
  });
});
