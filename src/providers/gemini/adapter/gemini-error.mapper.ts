import {
  AIProviderError,
  InvalidProviderConfigurationError,
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  type ProviderUnavailableDiagnostics,
} from '../../../core/ai-provider';
import { GEMINI_PROVIDER_ID } from '../types';
import type { GeminiAbortContext } from './gemini-abort-context';

const TRANSPORT_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export class GeminiErrorMapper {
  map(
    error: unknown,
    requestId: string,
    timeoutMs: number,
    abortContext: GeminiAbortContext = { callerInitiatedAbort: false },
  ): Error {
    if (error instanceof AIProviderError) return error;
    if (isAbortError(error)) {
      if (abortContext.callerInitiatedAbort) {
        return new ProviderCancelledError(requestId, abortContext.cancellationReason);
      }
      return new ProviderTimeoutError(GEMINI_PROVIDER_ID, timeoutMs);
    }
    if (isTimeoutError(error) || hasStatus(error, 408)) {
      return new ProviderTimeoutError(GEMINI_PROVIDER_ID, timeoutMs);
    }
    if (hasStatus(error, 429) || hasServerErrorStatus(error)) {
      return new ProviderUnavailableError(
        GEMINI_PROVIDER_ID,
        extractSafeProviderUnavailableDiagnostics(error),
      );
    }
    if (hasStatus(error, 401) || hasStatus(error, 403) || hasStatus(error, 404)) {
      return new InvalidProviderConfigurationError([
        { path: '$.credentialsOrModel', message: 'was rejected by the provider' },
      ]);
    }
    if (hasNumericStatus(error)) {
      return new ProviderContractViolationError('REQUEST', [
        { path: '$', message: `provider rejected the request with status ${error.status}` },
      ]);
    }
    return new ProviderUnavailableError(
      GEMINI_PROVIDER_ID,
      extractSafeProviderUnavailableDiagnostics(error),
    );
  }
}

export function extractSafeProviderUnavailableDiagnostics(
  error: unknown,
): ProviderUnavailableDiagnostics {
  const sdkErrorName = readSdkErrorName(error);
  const providerErrorCode = readTransportErrorCode(error);
  const retryAfterMs = parseRetryAfterMs(error);

  if (hasStatus(error, 429)) {
    return compactDiagnostics({
      providerStatus: 429,
      providerErrorCategory: 'RATE_LIMIT',
      sdkErrorName,
      providerErrorCode,
      retryAfterMs,
    });
  }
  if (hasServerErrorStatus(error)) {
    return compactDiagnostics({
      providerStatus: (error as { readonly status: number }).status,
      providerErrorCategory: 'UPSTREAM_5XX',
      sdkErrorName,
      retryAfterMs,
    });
  }
  if (providerErrorCode !== undefined || error instanceof TypeError) {
    return compactDiagnostics({
      providerErrorCategory: 'TRANSPORT',
      sdkErrorName,
      providerErrorCode,
    });
  }
  return compactDiagnostics({
    providerErrorCategory: 'UNKNOWN',
    sdkErrorName,
    providerErrorCode,
  });
}

function compactDiagnostics(
  diagnostics: ProviderUnavailableDiagnostics,
): ProviderUnavailableDiagnostics {
  return {
    providerErrorCategory: diagnostics.providerErrorCategory,
    ...(diagnostics.providerStatus === undefined
      ? {}
      : { providerStatus: diagnostics.providerStatus }),
    ...(diagnostics.providerErrorCode === undefined
      ? {}
      : { providerErrorCode: diagnostics.providerErrorCode }),
    ...(diagnostics.sdkErrorName === undefined ? {} : { sdkErrorName: diagnostics.sdkErrorName }),
    ...(diagnostics.retryAfterMs === undefined ? {} : { retryAfterMs: diagnostics.retryAfterMs }),
  };
}

function readSdkErrorName(error: unknown): string | undefined {
  if (error instanceof Error && error.name.length > 0) return error.name;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = Reflect.get(error, 'name');
    return typeof name === 'string' && name.length > 0 ? name : undefined;
  }
  return undefined;
}

function readTransportErrorCode(error: unknown): string | undefined {
  const direct = readErrorCode(error);
  if (direct !== undefined && TRANSPORT_ERROR_CODES.has(direct)) return direct;
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    const nested = readErrorCode(Reflect.get(error, 'cause'));
    if (nested !== undefined && TRANSPORT_ERROR_CODES.has(nested)) return nested;
  }
  return undefined;
}

function readErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('code' in value)) return undefined;
  const code = Reflect.get(value, 'code');
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function parseRetryAfterMs(error: unknown): number | undefined {
  const raw = readRetryAfterValue(error);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0 && !trimmed.includes('-')) {
    return Math.round(seconds * 1_000);
  }
  const retryAt = Date.parse(trimmed);
  if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  return undefined;
}

function readRetryAfterValue(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const retryAfter = Reflect.get(error, 'retryAfter');
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0) {
    return String(retryAfter);
  }
  if (typeof retryAfter === 'string' && retryAfter.trim().length > 0) return retryAfter;
  const headers = readHeaderRecord(error);
  if (headers === undefined) return undefined;
  const value = headers['retry-after'] ?? headers['Retry-After'];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readHeaderRecord(error: unknown): Record<string, string> | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const headers = Reflect.get(error, 'headers');
  if (headers instanceof Headers) {
    const retryAfter = headers.get('retry-after') ?? headers.get('Retry-After');
    return retryAfter === null ? undefined : { 'retry-after': retryAfter };
  }
  if (typeof headers === 'object' && headers !== null) {
    const record: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') record[key.toLowerCase()] = value;
    }
    return Object.keys(record).length > 0 ? record : undefined;
  }
  const response = Reflect.get(error, 'response');
  if (typeof response === 'object' && response !== null) {
    return readHeaderRecord(response);
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || ('code' in error && error.code === 'ETIMEDOUT'))
  );
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
