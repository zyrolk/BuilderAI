/**
 * Typed semantic outcomes for provider prepare results.
 * NO_CHANGE and INSUFFICIENT_EVIDENCE are distinct from provider failures.
 */

export const PREPARE_OUTCOME_KINDS = [
  'READY_FOR_REVIEW',
  'NO_CHANGE',
  'INSUFFICIENT_EVIDENCE',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_CANCELLED',
  'OUTPUT_TRUNCATED',
  'INVALID_PROVIDER_RESPONSE',
] as const;

export type PrepareOutcomeKind = (typeof PREPARE_OUTCOME_KINDS)[number];

export interface PrepareOutcome {
  readonly kind: PrepareOutcomeKind;
  readonly reason?: string;
}

export const NO_CHANGE_REASONS = [
  'NO_SAFE_CHANGE_IDENTIFIED',
  'CURRENT_CODE_SATISFIES_REQUEST',
  'EVIDENCE_INSUFFICIENT_FOR_SAFE_CHANGE',
  'REQUESTED_BEHAVIOR_UNSUPPORTED',
] as const;

export type NoChangeReason = (typeof NO_CHANGE_REASONS)[number];

export interface NoChangeOutcome extends PrepareOutcome {
  readonly kind: 'NO_CHANGE';
  readonly noChangeReason: NoChangeReason;
}

export interface InsufficientEvidenceOutcome extends PrepareOutcome {
  readonly kind: 'INSUFFICIENT_EVIDENCE';
}

export function isNoChangeOutcome(outcome: PrepareOutcome): outcome is NoChangeOutcome {
  return outcome.kind === 'NO_CHANGE';
}

export function isInsufficientEvidenceOutcome(
  outcome: PrepareOutcome,
): outcome is InsufficientEvidenceOutcome {
  return outcome.kind === 'INSUFFICIENT_EVIDENCE';
}

export function isApprovableOutcome(outcome: PrepareOutcome): boolean {
  return outcome.kind === 'READY_FOR_REVIEW';
}

/**
 * Classifies a provider response with zero operations into either NO_CHANGE or
 * INSUFFICIENT_EVIDENCE based on whether the provider gave semantic confidence.
 */
export function classifyEmptyResponse(
  hasSemanticNoChangeSignal: boolean,
  reason?: string,
): PrepareOutcome {
  if (hasSemanticNoChangeSignal) {
    return {
      kind: 'NO_CHANGE',
      noChangeReason: 'NO_SAFE_CHANGE_IDENTIFIED',
      reason: reason ?? 'Provider determined no change is needed.',
    } as NoChangeOutcome;
  }
  return {
    kind: 'INSUFFICIENT_EVIDENCE',
    reason: reason ?? 'Provider returned no operations without sufficient semantic context.',
  } as InsufficientEvidenceOutcome;
}

export function classifyProviderError(errorCode: string): PrepareOutcomeKind {
  switch (errorCode) {
    case 'PROVIDER_UNAVAILABLE':
      return 'PROVIDER_UNAVAILABLE';
    case 'TIMEOUT':
      return 'PROVIDER_TIMEOUT';
    case 'CANCELLED':
      return 'PROVIDER_CANCELLED';
    case 'OUTPUT_TRUNCATED':
      return 'OUTPUT_TRUNCATED';
    case 'CONTRACT_VIOLATION':
    case 'INVALID_CONFIGURATION':
    case 'UNSUPPORTED_CAPABILITY':
      return 'INVALID_PROVIDER_RESPONSE';
    default:
      return 'PROVIDER_UNAVAILABLE';
  }
}

export function isRateLimitOutcome(errorCode: string, providerStatus?: number): boolean {
  return errorCode === 'PROVIDER_UNAVAILABLE' && providerStatus === 429;
}
