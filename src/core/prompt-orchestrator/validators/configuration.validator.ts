import type { PromptOrchestratorConfiguration } from '../config';
import { PromptOrchestratorValidationError, type PromptValidationIssue } from '../types';
import {
  addIssue,
  isPositiveSafeInteger,
  isRecord,
  PROMPT_IDENTIFIER_PATTERN,
} from './validation-helpers';

export class PromptOrchestratorConfigurationValidator {
  validate(value: unknown): asserts value is PromptOrchestratorConfiguration {
    const issues: PromptValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_PROMPT_STRUCTURE', '$', 'must be an object');
    } else {
      const allowed = ['templateId', 'templateVersion', 'maximumCharacters'];
      for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
          addIssue(issues, 'INVALID_PROMPT_STRUCTURE', `$.${key}`, 'is not allowed');
        }
      }
      if (
        typeof value.templateId !== 'string' ||
        !PROMPT_IDENTIFIER_PATTERN.test(value.templateId)
      ) {
        addIssue(
          issues,
          'INVALID_PROMPT_STRUCTURE',
          '$.templateId',
          'must be a lowercase kebab-case identifier',
        );
      }
      if (value.templateVersion !== undefined && !isPositiveSafeInteger(value.templateVersion)) {
        addIssue(
          issues,
          'INVALID_PROMPT_STRUCTURE',
          '$.templateVersion',
          'must be a positive safe integer when present',
        );
      }
      if (!isPositiveSafeInteger(value.maximumCharacters)) {
        addIssue(
          issues,
          'INVALID_PROMPT_STRUCTURE',
          '$.maximumCharacters',
          'must be a positive safe integer',
        );
      }
    }
    if (issues.length > 0) throw new PromptOrchestratorValidationError(issues);
  }
}
