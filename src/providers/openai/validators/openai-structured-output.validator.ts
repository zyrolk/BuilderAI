import {
  ProviderContractViolationError,
  type ProviderJsonValue,
  type ProviderValidationIssue,
} from '../../../core/ai-provider';
import type {
  PromptOutputContract,
  PromptOutputFieldType,
} from '../../../core/prompt-orchestrator';
import { addIssue, isRecord } from './validation-helpers';

export class OpenAIStructuredOutputValidator {
  validate(value: unknown, contract: PromptOutputContract): asserts value is ProviderJsonValue {
    const issues: ProviderValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, '$.output', 'must be an object');
    } else {
      const fields = new Map(contract.fields.map((field) => [field.name, field]));
      for (const field of contract.fields) {
        if (!(field.name in value)) {
          if (field.required) addIssue(issues, `$.output.${field.name}`, 'is required');
          continue;
        }
        if (!matchesType(value[field.name], field.type)) {
          addIssue(issues, `$.output.${field.name}`, `must match type ${field.type}`);
        }
      }
      if (!contract.allowAdditionalFields) {
        for (const name of Object.keys(value)) {
          if (!fields.has(name)) addIssue(issues, `$.output.${name}`, 'is not allowed');
        }
      }
      if (!isJsonValue(value)) addIssue(issues, '$.output', 'must contain only finite JSON values');
    }
    if (issues.length > 0) throw new ProviderContractViolationError('RESPONSE', issues);
  }
}

function matchesType(value: unknown, type: PromptOutputFieldType): boolean {
  switch (type) {
    case 'STRING':
      return typeof value === 'string';
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'OBJECT':
      return isRecord(value);
    case 'ARRAY':
      return Array.isArray(value);
  }
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is ProviderJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (!Array.isArray(value)) {
    const prototype: object | null = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}
