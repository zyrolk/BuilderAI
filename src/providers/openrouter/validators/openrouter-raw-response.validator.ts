import {
  ProviderContractViolationError,
  type ProviderValidationIssue,
} from '../../../core/ai-provider';
import type { OpenRouterRawResponse } from '../types';
import { assertSuccessfulFinishReason } from './openrouter-finish-reason';
import {
  addIssue,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
} from './validation-helpers';

export class OpenRouterRawResponseValidator {
  parse(value: unknown): OpenRouterRawResponse {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      if (!isNonEmptyString(value.id)) addIssue(issues, '$.id', 'is required');
      if (!isNonEmptyString(value.model)) addIssue(issues, '$.model', 'is required');
      this.validateChoices(value.choices, issues);
      this.validateUsage(value.usage, issues);
    }
    if (issues.length > 0 || !isRawResponse(value)) {
      throw new ProviderContractViolationError(
        'RESPONSE',
        issues.length > 0 ? issues : [{ path: '$', message: 'could not be normalized' }],
      );
    }
    const choice = value.choices[0];
    assertSuccessfulFinishReason(choice.finish_reason);
    const message = choice.message;
    const usage = value.usage;
    return {
      id: value.id,
      model: value.model,
      finishReason: choice.finish_reason,
      content: message.content,
      usage: {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      },
    };
  }

  private validateChoices(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
      addIssue(issues, '$.choices', 'must contain exactly one choice');
      return;
    }
    const choice = value[0];
    if (!isNonEmptyString(choice.finish_reason)) {
      addIssue(issues, '$.choices[0].finish_reason', 'must be a non-empty string');
    }
    if (!isRecord(choice.message)) {
      addIssue(issues, '$.choices[0].message', 'must be an object');
      return;
    }
    if (choice.message.role !== 'assistant') {
      addIssue(issues, '$.choices[0].message.role', 'must equal assistant');
    }
    if (typeof choice.message.content !== 'string') {
      addIssue(issues, '$.choices[0].message.content', 'must be a string');
    }
  }

  private validateUsage(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, '$.usage', 'must be an object');
      return;
    }
    for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
      if (!isNonNegativeSafeInteger(value[field])) {
        addIssue(issues, `$.usage.${field}`, 'must be a non-negative safe integer');
      }
    }
    if (
      isNonNegativeSafeInteger(value.prompt_tokens) &&
      isNonNegativeSafeInteger(value.completion_tokens) &&
      isNonNegativeSafeInteger(value.total_tokens) &&
      value.total_tokens !== value.prompt_tokens + value.completion_tokens
    ) {
      addIssue(issues, '$.usage.total_tokens', 'must equal prompt_tokens plus completion_tokens');
    }
  }
}

interface RawResponseShape {
  readonly id: string;
  readonly model: string;
  readonly choices: readonly [
    {
      readonly finish_reason: string;
      readonly message: { readonly role: 'assistant'; readonly content: string };
    },
  ];
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

function isRawResponse(value: unknown): value is RawResponseShape {
  if (!isRecord(value) || !isNonEmptyString(value.id) || !isNonEmptyString(value.model)) {
    return false;
  }
  if (!Array.isArray(value.choices) || value.choices.length !== 1) return false;
  const choice = value.choices[0];
  const usage = value.usage;
  return (
    isRecord(choice) &&
    isNonEmptyString(choice.finish_reason) &&
    isRecord(choice.message) &&
    choice.message.role === 'assistant' &&
    typeof choice.message.content === 'string' &&
    isRecord(usage) &&
    isNonNegativeSafeInteger(usage.prompt_tokens) &&
    isNonNegativeSafeInteger(usage.completion_tokens) &&
    isNonNegativeSafeInteger(usage.total_tokens)
  );
}
