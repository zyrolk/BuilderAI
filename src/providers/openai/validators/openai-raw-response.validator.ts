import {
  ProviderContractViolationError,
  type ProviderValidationIssue,
} from '../../../core/ai-provider';
import type { OpenAIRawResponse } from '../types';
import {
  addIssue,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
} from './validation-helpers';

const STATUSES = [
  'completed',
  'failed',
  'in_progress',
  'cancelled',
  'queued',
  'incomplete',
] as const;

export class OpenAIRawResponseValidator {
  parse(value: unknown): OpenAIRawResponse {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      if (!isNonEmptyString(value.id)) addIssue(issues, '$.id', 'is required');
      if (!isNonEmptyString(value.model)) addIssue(issues, '$.model', 'is required');
      if (!STATUSES.includes(value.status as never)) addIssue(issues, '$.status', 'is unsupported');
      if (typeof value.output_text !== 'string') {
        addIssue(issues, '$.output_text', 'must be a string');
      }
      this.validateError(value.error, value.status, issues);
      this.validateUsage(value.usage, value.status, issues);
    }
    if (issues.length > 0 || !isRawResponse(value)) {
      throw new ProviderContractViolationError(
        'RESPONSE',
        issues.length > 0 ? issues : [{ path: '$', message: 'could not be normalized' }],
      );
    }
    const usage = value.usage;
    const error = value.error;
    return {
      id: value.id,
      model: value.model,
      status: value.status,
      outputText: value.output_text,
      error: error === null ? null : { code: error.code, message: error.message },
      usage:
        usage === null
          ? null
          : {
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              totalTokens: usage.total_tokens,
            },
    };
  }

  private validateError(value: unknown, status: unknown, issues: ProviderValidationIssue[]): void {
    if (value === null) {
      if (status === 'failed') addIssue(issues, '$.error', 'is required for a failed response');
      return;
    }
    if (!isRecord(value)) {
      addIssue(issues, '$.error', 'must be an object or null');
      return;
    }
    if (!isNonEmptyString(value.code)) addIssue(issues, '$.error.code', 'is required');
    if (!isNonEmptyString(value.message)) addIssue(issues, '$.error.message', 'is required');
    if (status === 'completed')
      addIssue(issues, '$.error', 'must be null for a completed response');
  }

  private validateUsage(value: unknown, status: unknown, issues: ProviderValidationIssue[]): void {
    if (value === null || value === undefined) {
      if (status === 'completed')
        addIssue(issues, '$.usage', 'is required for a completed response');
      return;
    }
    if (!isRecord(value)) {
      addIssue(issues, '$.usage', 'must be an object or null');
      return;
    }
    for (const field of ['input_tokens', 'output_tokens', 'total_tokens'] as const) {
      if (!isNonNegativeSafeInteger(value[field])) {
        addIssue(issues, `$.usage.${field}`, 'must be a non-negative safe integer');
      }
    }
    if (
      isNonNegativeSafeInteger(value.input_tokens) &&
      isNonNegativeSafeInteger(value.output_tokens) &&
      isNonNegativeSafeInteger(value.total_tokens) &&
      value.total_tokens !== value.input_tokens + value.output_tokens
    ) {
      addIssue(issues, '$.usage.total_tokens', 'must equal input_tokens plus output_tokens');
    }
  }
}

interface RawResponseShape {
  readonly id: string;
  readonly model: string;
  readonly status: OpenAIRawResponse['status'];
  readonly output_text: string;
  readonly error: null | { readonly code: string; readonly message: string };
  readonly usage: null | {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
  };
}

function isRawResponse(value: unknown): value is RawResponseShape {
  if (!isRecord(value)) return false;
  const errorValid =
    value.error === null ||
    (isRecord(value.error) &&
      isNonEmptyString(value.error.code) &&
      isNonEmptyString(value.error.message));
  const usageValid =
    value.usage === null ||
    (isRecord(value.usage) &&
      isNonNegativeSafeInteger(value.usage.input_tokens) &&
      isNonNegativeSafeInteger(value.usage.output_tokens) &&
      isNonNegativeSafeInteger(value.usage.total_tokens));
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.model) &&
    STATUSES.includes(value.status as never) &&
    typeof value.output_text === 'string' &&
    errorValid &&
    usageValid
  );
}
