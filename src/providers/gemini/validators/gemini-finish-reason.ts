import {
  ProviderContractViolationError,
  ProviderOutputTruncatedError,
  type ProviderOutputTruncatedDiagnostics,
} from '../../../core/ai-provider';
import { GEMINI_PROVIDER_ID } from '../types';

const POLICY_FINISH_REASONS: ReadonlySet<string> = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'SPII',
  'BLOCKLIST',
  'RECITATION',
]);

const TERMINAL_CONTRACT_FINISH_REASONS: ReadonlySet<string> = new Set([
  'MALFORMED_FUNCTION_CALL',
  'OTHER',
  'FINISH_REASON_UNSPECIFIED',
]);

/**
 * Enforces ADR-026 finish-reason policy. Only STOP is a successful completion.
 * Truncation and policy failures must not expose raw provider output.
 */
export function assertSuccessfulFinishReason(
  finishReason: string,
  truncationDiagnostics?: ProviderOutputTruncatedDiagnostics,
): void {
  if (finishReason === 'STOP') return;
  if (finishReason === 'MAX_TOKENS') {
    throw new ProviderOutputTruncatedError(GEMINI_PROVIDER_ID, truncationDiagnostics);
  }
  if (POLICY_FINISH_REASONS.has(finishReason)) {
    throw new ProviderContractViolationError('RESPONSE', [
      {
        path: '$.candidates[0].finishReason',
        message: 'generation blocked by provider safety policy',
      },
    ]);
  }
  if (TERMINAL_CONTRACT_FINISH_REASONS.has(finishReason)) {
    throw new ProviderContractViolationError('RESPONSE', [
      { path: '$.candidates[0].finishReason', message: 'must equal STOP' },
    ]);
  }
  throw new ProviderContractViolationError('RESPONSE', [
    {
      path: '$.candidates[0].finishReason',
      message: 'is an unsupported completion reason',
    },
  ]);
}
