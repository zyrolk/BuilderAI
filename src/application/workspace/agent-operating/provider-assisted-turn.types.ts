/**
 * Bounded operator-facing taxonomy for B10 provider-assisted turns (ADR-046).
 * Digest-only — never carries raw provider output, secrets, or authority fields.
 */

export const PROVIDER_ASSISTED_REJECTION_CODES = [
  'EMPTY_INTENTS',
  'MALFORMED_OUTPUT',
  'MISSING_INTENTS_ARRAY',
  'EXCEEDS_INTENT_CAP',
  'AUTHORITY_FIELD_FORBIDDEN',
  'INVALID_INTENT_SCHEMA',
  'FORBIDDEN_TOOL',
  'NO_STRUCTURED_DATA',
  'INVALID_JSON',
  'PROVIDER_EXECUTION_FAILED',
  'ALL_INTENTS_REJECTED',
] as const;

export type ProviderAssistedRejectionCode = (typeof PROVIDER_ASSISTED_REJECTION_CODES)[number];

export const PROVIDER_ASSISTED_OPERATOR_ACTIONS = [
  'RETRY_PROVIDER_ASSISTED',
  'CORRECT_PHASE',
  'ENABLE_BROWSER_APPROVAL',
  'USE_OPERATOR_PRESET',
  'REVIEW_GOAL',
] as const;

export type ProviderAssistedOperatorAction = (typeof PROVIDER_ASSISTED_OPERATOR_ACTIONS)[number];

/** Single bounded rejection entry (no raw provider text). */
export interface ProviderAssistedIntentRejection {
  readonly code: ProviderAssistedRejectionCode;
  readonly intentIndex?: number;
  readonly intentId?: string;
  readonly toolId?: string;
  readonly message: string;
  readonly operatorAction: ProviderAssistedOperatorAction;
}

/** Digest-only emission summary for operator observability. */
export interface ProviderAssistedTurnDigest {
  readonly source: 'provider-structured-intent';
  readonly toolCalling: false;
  readonly proposedCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly rejections: readonly ProviderAssistedIntentRejection[];
}
