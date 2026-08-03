import { AI_PROVIDER_CONTRACT_VERSION, ProviderRequestValidator } from '../../ai-provider';
import { createDescriptor } from '../../ai-provider/test/ai-provider.fixture';
import { ExecutionRequestValidator } from '../../execution-engine';
import { createExecutionRequest } from '../../execution-engine/test/execution-engine.fixture';
import { GeminiExecutionRequestMapper } from '../../../providers/gemini/mapper/gemini-execution-request.mapper';
import { GeminiRequestMapper } from '../../../providers/gemini/mapper/gemini-request.mapper';
import { GEMINI_PROVIDER_ID } from '../../../providers/gemini/types';
import { createGeminiConfiguration } from '../../../providers/gemini/test/gemini-provider.fixture';
import { PromptPackageValidator } from '../validators/prompt-package.validator';
import {
  TruncationRetryCompactionService,
  buildCompactedPrompt,
  deriveCompactionAllowlist,
} from '../services/truncation-retry-compaction.service';
import { createCorrectionPromptPackage } from './truncation-retry.fixture';

const SERVICE_PATH = 'src/application/workspace/activity-history.service.ts';
const TEST_PATH = 'src/application/workspace/activity-history.service.test.ts';

describe('ADR-029 compacted prompt budget invariant (live failure regression)', () => {
  const compaction = new TruncationRetryCompactionService();
  const promptValidator: PromptPackageValidator = new PromptPackageValidator();
  const executionValidator: ExecutionRequestValidator = new ExecutionRequestValidator();
  const providerRequestValidator: ProviderRequestValidator = new ProviderRequestValidator();

  it('recomputes compacted budget.characters and passes REQUEST contract validation', async () => {
    const canonicalPrompt = await createCorrectionPromptPackage({
      updated: [SERVICE_PATH, TEST_PATH],
    });

    promptValidator.validate(canonicalPrompt);
    expect(canonicalPrompt.budget.characters).toBe(JSON.stringify(canonicalPrompt).length);

    const executionRequest = await createExecutionRequest({ prompt: canonicalPrompt });
    executionValidator.validate(executionRequest);

    const allowlist = deriveCompactionAllowlist(canonicalPrompt);
    expect(allowlist).toEqual([TEST_PATH, SERVICE_PATH]);

    const resolution = compaction.resolveAttempt({
      prompt: canonicalPrompt,
      attempt: 2,
      priorFailureCode: 'OUTPUT_TRUNCATED',
    });

    expect(resolution.boundingActive).toBe(true);
    expect(resolution.compactionActive).toBe(true);
    expect(resolution.allowlist).toEqual(allowlist);
    expect(resolution.prompt).not.toBe(canonicalPrompt);
    expect(canonicalPrompt.budget.characters).toBe(JSON.stringify(canonicalPrompt).length);

    const compacted = resolution.prompt;
    const iteration = compacted.sections.find(({ kind }) => kind === 'ITERATION');
    expect(iteration?.kind).toBe('ITERATION');
    if (iteration?.kind !== 'ITERATION') throw new Error('Expected iteration section.');
    expect(
      iteration.instructions.some(({ text }) => text.includes('OUTPUT_TRUNCATION_RETRY')),
    ).toBe(true);
    expect(compacted.budget.characters).toBe(JSON.stringify(compacted).length);
    expect(compacted.budget.characters).toBeGreaterThan(canonicalPrompt.budget.characters);
    expect(compacted.budget.maximumCharacters).toBe(canonicalPrompt.budget.maximumCharacters);
    expect(compacted.budget.omittedSections).toEqual(canonicalPrompt.budget.omittedSections);

    promptValidator.validate(compacted);
    providerRequestValidator.validate({
      contractVersion: AI_PROVIDER_CONTRACT_VERSION,
      requestId: executionRequest.executionId,
      prompt: compacted,
      executionMode: 'SINGLE_RESPONSE',
      constraints: {
        maximumOutputCharacters: 20_000,
        requiredArtifactKinds: ['STRUCTURED_DATA'],
        requiredCapabilities: ['CONTEXT_INGESTION', 'STRUCTURED_RESPONSES'],
        requireStructuredResponse: true,
      },
      timeoutMs: 30_000,
      cancellation: executionRequest.cancellation,
      metadata: compaction.appendAttemptMetadata(
        { 'correlation-id': executionRequest.metadata.correlationId, attempt: 2 },
        resolution,
      ),
    });

    const geminiConfiguration = createGeminiConfiguration();
    const executionMapper = new GeminiExecutionRequestMapper();
    const providerRequest = executionMapper.map(
      executionRequest,
      geminiConfiguration,
      2,
      30_000,
      resolution,
    );
    expect(providerRequest.prompt).toBe(compacted);

    const geminiRequestMapper = new GeminiRequestMapper(
      createDescriptor(GEMINI_PROVIDER_ID),
      geminiConfiguration,
    );
    expect(() => geminiRequestMapper.map(providerRequest)).not.toThrow();
  });

  it('buildCompactedPrompt alone satisfies the production budget invariant', async () => {
    const canonicalPrompt = await createCorrectionPromptPackage({
      updated: [SERVICE_PATH, TEST_PATH],
    });
    const allowlist = deriveCompactionAllowlist(canonicalPrompt);
    const compacted = buildCompactedPrompt(canonicalPrompt, allowlist);

    expect(compacted).not.toBe(canonicalPrompt);
    expect(compacted.budget.characters).toBe(JSON.stringify(compacted).length);
    promptValidator.validate(compacted);
  });
});
