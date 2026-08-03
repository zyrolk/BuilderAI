import {
  ProviderContractViolationError,
  type ProviderValidationIssue,
} from '../../../core/ai-provider';
import type { GeminiRawResponse } from '../types';
import { assertSuccessfulFinishReason } from './gemini-finish-reason';
import {
  addIssue,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
} from './validation-helpers';

export class GeminiRawResponseValidator {
  parse(value: unknown): GeminiRawResponse {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$', 'must be an object');
    } else {
      if (value.responseId !== undefined && !isNonEmptyString(value.responseId)) {
        addIssue(issues, '$.responseId', 'must be a non-empty string when present');
      }
      if (value.modelVersion !== undefined && !isNonEmptyString(value.modelVersion)) {
        addIssue(issues, '$.modelVersion', 'must be a non-empty string when present');
      }
      if (!isNonEmptyString(value.text)) addIssue(issues, '$.text', 'is required');
      this.validatePromptFeedback(value.promptFeedback, issues);
      this.validateCandidates(value.candidates, issues);
      this.validateUsage(value.usageMetadata, issues);
    }
    if (issues.length > 0 || !isRawResponse(value)) {
      throw new ProviderContractViolationError(
        'RESPONSE',
        issues.length > 0 ? issues : [{ path: '$', message: 'could not be normalized' }],
      );
    }
    const candidate = value.candidates[0];
    const usage = value.usageMetadata;
    assertSuccessfulFinishReason(candidate.finishReason, {
      finishReason: candidate.finishReason,
      inputTokens: usage.promptTokenCount,
      outputTokens: usage.candidatesTokenCount,
    });
    return {
      ...(value.responseId === undefined ? {} : { responseId: value.responseId }),
      ...(value.modelVersion === undefined ? {} : { modelVersion: value.modelVersion }),
      text: value.text,
      finishReason: candidate.finishReason,
      usage: {
        inputTokens: usage.promptTokenCount,
        outputTokens: usage.candidatesTokenCount,
        totalTokens: usage.totalTokenCount,
      },
    };
  }

  private validatePromptFeedback(value: unknown, issues: ProviderValidationIssue[]): void {
    if (value === undefined) return;
    if (!isRecord(value)) {
      addIssue(issues, '$.promptFeedback', 'must be an object when present');
      return;
    }
    if (value.blockReason !== undefined) {
      addIssue(issues, '$.promptFeedback.blockReason', 'must be absent for a completed response');
    }
  }

  private validateCandidates(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
      addIssue(issues, '$.candidates', 'must contain exactly one candidate');
      return;
    }
    if (!isNonEmptyString(value[0].finishReason)) {
      addIssue(issues, '$.candidates[0].finishReason', 'must be a non-empty string');
    }
  }

  private validateUsage(value: unknown, issues: ProviderValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, '$.usageMetadata', 'must be an object');
      return;
    }
    for (const field of ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount'] as const) {
      if (!isNonNegativeSafeInteger(value[field])) {
        addIssue(issues, `$.usageMetadata.${field}`, 'must be a non-negative safe integer');
      }
    }
    if (
      isNonNegativeSafeInteger(value.promptTokenCount) &&
      isNonNegativeSafeInteger(value.candidatesTokenCount) &&
      isNonNegativeSafeInteger(value.totalTokenCount) &&
      value.totalTokenCount < value.promptTokenCount + value.candidatesTokenCount
    ) {
      addIssue(
        issues,
        '$.usageMetadata.totalTokenCount',
        'must include prompt and candidate tokens',
      );
    }
  }
}

interface RawResponseShape {
  readonly responseId?: string;
  readonly modelVersion?: string;
  readonly text: string;
  readonly candidates: readonly [{ readonly finishReason: string }];
  readonly usageMetadata: {
    readonly promptTokenCount: number;
    readonly candidatesTokenCount: number;
    readonly totalTokenCount: number;
  };
}

function isRawResponse(value: unknown): value is RawResponseShape {
  if (!isRecord(value) || !isNonEmptyString(value.text)) return false;
  if (value.responseId !== undefined && !isNonEmptyString(value.responseId)) return false;
  if (value.modelVersion !== undefined && !isNonEmptyString(value.modelVersion)) return false;
  if (!Array.isArray(value.candidates) || value.candidates.length !== 1) return false;
  const candidate = value.candidates[0];
  const usage = value.usageMetadata;
  return (
    isRecord(candidate) &&
    isNonEmptyString(candidate.finishReason) &&
    isRecord(usage) &&
    isNonNegativeSafeInteger(usage.promptTokenCount) &&
    isNonNegativeSafeInteger(usage.candidatesTokenCount) &&
    isNonNegativeSafeInteger(usage.totalTokenCount)
  );
}
