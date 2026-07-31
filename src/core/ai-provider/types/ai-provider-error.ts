import type { ProviderCapabilityName, ProviderValidationIssue } from './ai-provider';

export type AIProviderErrorCode =
  | 'CANCELLED'
  | 'CONTRACT_VIOLATION'
  | 'INVALID_CONFIGURATION'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNSUPPORTED_CAPABILITY';

export abstract class AIProviderError extends Error {
  abstract readonly code: AIProviderErrorCode;

  protected constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class UnsupportedCapabilityError extends AIProviderError {
  readonly code = 'UNSUPPORTED_CAPABILITY' as const;

  constructor(
    readonly providerId: string,
    readonly capabilities: readonly ProviderCapabilityName[],
  ) {
    super(`Provider '${providerId}' does not support: ${capabilities.join(', ')}.`);
  }
}

export class ProviderTimeoutError extends AIProviderError {
  readonly code = 'TIMEOUT' as const;

  constructor(
    readonly providerId: string,
    readonly timeoutMs: number,
  ) {
    super(`Provider '${providerId}' exceeded the ${timeoutMs}ms timeout.`);
  }
}

export class ProviderCancelledError extends AIProviderError {
  readonly code = 'CANCELLED' as const;

  constructor(
    readonly requestId: string,
    readonly reason?: string,
  ) {
    super(`Request '${requestId}' was cancelled${reason === undefined ? '' : `: ${reason}`}.`);
  }
}

export class InvalidProviderConfigurationError extends AIProviderError {
  readonly code = 'INVALID_CONFIGURATION' as const;

  constructor(readonly issues: readonly ProviderValidationIssue[]) {
    super(`Provider configuration is invalid: ${issues.map(formatIssue).join('; ')}.`);
  }
}

export class ProviderUnavailableError extends AIProviderError {
  readonly code = 'PROVIDER_UNAVAILABLE' as const;

  constructor(readonly providerId: string) {
    super(`Provider '${providerId}' is unavailable.`);
  }
}

export class ProviderContractViolationError extends AIProviderError {
  readonly code = 'CONTRACT_VIOLATION' as const;

  constructor(
    readonly contract: 'CAPABILITIES' | 'DESCRIPTOR' | 'REQUEST' | 'RESPONSE',
    readonly issues: readonly ProviderValidationIssue[],
  ) {
    super(`${contract} contract is invalid: ${issues.map(formatIssue).join('; ')}.`);
  }
}

function formatIssue(issue: ProviderValidationIssue): string {
  return `${issue.path} ${issue.message}`;
}
