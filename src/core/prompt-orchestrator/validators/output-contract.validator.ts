import {
  PROMPT_OUTPUT_CONTRACT_SCHEMA_VERSION,
  PROMPT_OUTPUT_FIELD_TYPES,
  PromptOrchestratorValidationError,
  type PromptOutputContract,
  type PromptValidationIssue,
} from '../types';
import {
  addIssue,
  duplicates,
  isNonEmptyString,
  isRecord,
  validateExactKeys,
} from './validation-helpers';

const FIELD_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

export class PromptOutputContractValidator {
  validate(value: unknown): asserts value is PromptOutputContract {
    const issues: PromptValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_OUTPUT_CONTRACT', '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        ['schemaVersion', 'type', 'fields', 'allowAdditionalFields'],
        '$',
        issues,
        'INVALID_OUTPUT_CONTRACT',
      );
      if (value.schemaVersion !== PROMPT_OUTPUT_CONTRACT_SCHEMA_VERSION) {
        addIssue(
          issues,
          'UNSUPPORTED_PROMPT_VERSION',
          '$.schemaVersion',
          `must equal ${PROMPT_OUTPUT_CONTRACT_SCHEMA_VERSION}`,
        );
      }
      if (value.type !== 'OBJECT') {
        addIssue(issues, 'INVALID_OUTPUT_CONTRACT', '$.type', "must equal 'OBJECT'");
      }
      if (typeof value.allowAdditionalFields !== 'boolean') {
        addIssue(issues, 'INVALID_OUTPUT_CONTRACT', '$.allowAdditionalFields', 'must be a boolean');
      }
      this.validateFields(value.fields, issues);
    }
    if (issues.length > 0) throw new PromptOrchestratorValidationError(issues);
  }

  private validateFields(value: unknown, issues: PromptValidationIssue[]): void {
    if (!Array.isArray(value) || value.length === 0) {
      addIssue(issues, 'INVALID_OUTPUT_CONTRACT', '$.fields', 'must be a non-empty array');
      return;
    }
    const names: string[] = [];
    value.forEach((field, index) => {
      const path = `$.fields[${index}]`;
      if (!isRecord(field)) {
        addIssue(issues, 'INVALID_OUTPUT_CONTRACT', path, 'must be an object');
        return;
      }
      validateExactKeys(
        field,
        ['name', 'description', 'type', 'required'],
        path,
        issues,
        'INVALID_OUTPUT_CONTRACT',
      );
      if (isNonEmptyString(field.name) && FIELD_NAME_PATTERN.test(field.name))
        names.push(field.name);
      else addIssue(issues, 'INVALID_OUTPUT_CONTRACT', `${path}.name`, 'has an invalid field name');
      if (!isNonEmptyString(field.description)) {
        addIssue(issues, 'INVALID_OUTPUT_CONTRACT', `${path}.description`, 'is required');
      }
      if (!PROMPT_OUTPUT_FIELD_TYPES.includes(field.type as never)) {
        addIssue(issues, 'INVALID_OUTPUT_CONTRACT', `${path}.type`, 'is unsupported');
      }
      if (typeof field.required !== 'boolean') {
        addIssue(issues, 'INVALID_OUTPUT_CONTRACT', `${path}.required`, 'must be a boolean');
      }
    });
    for (const duplicate of duplicates(names)) {
      addIssue(
        issues,
        'INVALID_OUTPUT_CONTRACT',
        '$.fields',
        `contains duplicate field '${duplicate}'`,
      );
    }
  }
}
