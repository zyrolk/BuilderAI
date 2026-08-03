import {
  ProviderContractViolationError,
  ProviderOutputTruncatedError,
} from '../../../core/ai-provider';
import { OPENROUTER_PROVIDER_ID } from '../types';

const POLICY_FINISH_REASONS: ReadonlySet<string> = new Set(['content_filter']);

/**
 * Enforces OpenRouter Chat Completions finish-reason policy. Only `stop` is a
 * successful completion. Truncation and policy failures must not expose raw
 * provider output.
 */
export function assertSuccessfulFinishReason(finishReason: string): void {
  if (finishReason === 'stop') return;
  if (finishReason === 'length') {
    throw new ProviderOutputTruncatedError(OPENROUTER_PROVIDER_ID);
  }
  if (POLICY_FINISH_REASONS.has(finishReason)) {
    throw new ProviderContractViolationError('RESPONSE', [
      {
        path: '$.choices[0].finish_reason',
        message: 'generation blocked by provider safety policy',
      },
    ]);
  }
  throw new ProviderContractViolationError('RESPONSE', [
    {
      path: '$.choices[0].finish_reason',
      message: 'is an unsupported completion reason',
    },
  ]);
}
