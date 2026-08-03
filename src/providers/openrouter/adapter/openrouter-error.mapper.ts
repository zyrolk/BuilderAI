import { APIConnectionError, APIConnectionTimeoutError, APIError, APIUserAbortError } from 'openai';
import {
  AIProviderError,
  InvalidProviderConfigurationError,
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from '../../../core/ai-provider';
import { OPENROUTER_PROVIDER_ID } from '../types';

export class OpenRouterErrorMapper {
  map(error: unknown, requestId: string, timeoutMs: number, cancellationReason?: string): Error {
    if (error instanceof AIProviderError) return error;
    if (error instanceof APIUserAbortError || isAbortError(error)) {
      return new ProviderCancelledError(requestId, cancellationReason);
    }
    if (error instanceof APIConnectionTimeoutError || hasStatus(error, 408)) {
      return new ProviderTimeoutError(OPENROUTER_PROVIDER_ID, timeoutMs);
    }
    if (
      error instanceof APIConnectionError ||
      hasStatus(error, 429) ||
      hasServerErrorStatus(error)
    ) {
      return new ProviderUnavailableError(OPENROUTER_PROVIDER_ID);
    }
    if (hasStatus(error, 401) || hasStatus(error, 403) || hasStatus(error, 404)) {
      return new InvalidProviderConfigurationError([
        { path: '$.credentialsOrModel', message: 'was rejected by the provider' },
      ]);
    }
    if (error instanceof APIError || hasNumericStatus(error)) {
      return new ProviderContractViolationError('REQUEST', [
        { path: '$', message: `provider rejected the request with status ${error.status}` },
      ]);
    }
    return new ProviderUnavailableError(OPENROUTER_PROVIDER_ID);
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function hasNumericStatus(error: unknown): error is { readonly status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  );
}

function hasStatus(error: unknown, status: number): boolean {
  return hasNumericStatus(error) && error.status === status;
}

function hasServerErrorStatus(error: unknown): boolean {
  return hasNumericStatus(error) && error.status >= 500;
}
