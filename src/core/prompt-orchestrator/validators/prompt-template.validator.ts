import {
  PROMPT_SECTION_ORDER,
  PROMPT_TEMPLATE_SCHEMA_VERSION,
  PromptOrchestratorValidationError,
  type PromptTemplate,
  type PromptValidationIssue,
} from '../types';
import {
  addIssue,
  duplicates,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  normalizedContent,
  PROMPT_IDENTIFIER_PATTERN,
  validateExactKeys,
} from './validation-helpers';

export class PromptTemplateValidator {
  validate(value: unknown): asserts value is PromptTemplate {
    const issues: PromptValidationIssue[] = [];
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_TEMPLATE', '$', 'must be an object');
    } else {
      validateExactKeys(
        value,
        ['schemaVersion', 'id', 'version', 'description', 'sections'],
        '$',
        issues,
        'INVALID_TEMPLATE',
      );
      if (value.schemaVersion !== PROMPT_TEMPLATE_SCHEMA_VERSION) {
        addIssue(
          issues,
          'UNSUPPORTED_PROMPT_VERSION',
          '$.schemaVersion',
          `must equal ${PROMPT_TEMPLATE_SCHEMA_VERSION}`,
        );
      }
      if (!isNonEmptyString(value.id) || !PROMPT_IDENTIFIER_PATTERN.test(value.id)) {
        addIssue(issues, 'INVALID_TEMPLATE', '$.id', 'must be a lowercase kebab-case identifier');
      }
      if (!isPositiveSafeInteger(value.version)) {
        addIssue(issues, 'INVALID_TEMPLATE', '$.version', 'must be a positive safe integer');
      }
      if (!isNonEmptyString(value.description)) {
        addIssue(issues, 'INVALID_TEMPLATE', '$.description', 'is required');
      }
      this.validateSections(value.sections, issues);
    }
    if (issues.length > 0) throw new PromptOrchestratorValidationError(issues);
  }

  private validateSections(value: unknown, issues: PromptValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_TEMPLATE', '$.sections', 'must be an array');
      return;
    }
    const sectionIds: string[] = [];
    const sectionKinds: string[] = [];
    const instructionIds: string[] = [];
    const instructionTexts: string[] = [];
    value.forEach((section, index) => {
      const path = `$.sections[${index}]`;
      if (!isRecord(section)) {
        addIssue(issues, 'INVALID_TEMPLATE', path, 'must be an object');
        return;
      }
      validateExactKeys(
        section,
        ['id', 'kind', 'required', 'instructions'],
        path,
        issues,
        'INVALID_TEMPLATE',
      );
      if (isNonEmptyString(section.id)) sectionIds.push(section.id);
      else addIssue(issues, 'INVALID_TEMPLATE', `${path}.id`, 'is required');
      if (typeof section.kind === 'string') sectionKinds.push(section.kind);
      else addIssue(issues, 'INVALID_TEMPLATE', `${path}.kind`, 'is required');
      if (typeof section.required !== 'boolean') {
        addIssue(issues, 'INVALID_TEMPLATE', `${path}.required`, 'must be a boolean');
      } else if (section.kind !== 'CONTEXT' && !section.required) {
        addIssue(issues, 'INVALID_TEMPLATE', `${path}.required`, 'must be true for this section');
      }
      if (section.kind === 'CONTEXT' && section.required) {
        addIssue(issues, 'INVALID_TEMPLATE', `${path}.required`, 'must be false for CONTEXT');
      }
      if (!Array.isArray(section.instructions)) {
        addIssue(issues, 'INVALID_TEMPLATE', `${path}.instructions`, 'must be an array');
        return;
      }
      section.instructions.forEach((instruction, instructionIndex) => {
        const instructionPath = `${path}.instructions[${instructionIndex}]`;
        if (!isRecord(instruction)) {
          addIssue(issues, 'INVALID_TEMPLATE', instructionPath, 'must be an object');
          return;
        }
        validateExactKeys(instruction, ['id', 'text'], instructionPath, issues, 'INVALID_TEMPLATE');
        if (isNonEmptyString(instruction.id)) instructionIds.push(instruction.id);
        else addIssue(issues, 'INVALID_TEMPLATE', `${instructionPath}.id`, 'is required');
        if (isNonEmptyString(instruction.text)) {
          instructionTexts.push(normalizedContent(instruction.text));
        } else {
          addIssue(issues, 'INVALID_TEMPLATE', `${instructionPath}.text`, 'is required');
        }
      });
    });

    if (JSON.stringify(sectionKinds) !== JSON.stringify(PROMPT_SECTION_ORDER)) {
      addIssue(
        issues,
        'INVALID_SECTION_ORDER',
        '$.sections',
        'must contain every canonical section in stable order',
      );
    }
    for (const duplicate of duplicates(sectionIds)) {
      addIssue(issues, 'DUPLICATE_SECTION', '$.sections', `contains duplicate id '${duplicate}'`);
    }
    for (const duplicate of duplicates(sectionKinds)) {
      addIssue(issues, 'DUPLICATE_SECTION', '$.sections', `contains duplicate kind '${duplicate}'`);
    }
    for (const duplicate of duplicates(instructionIds)) {
      addIssue(
        issues,
        'DUPLICATE_INFORMATION',
        '$.sections',
        `contains duplicate instruction id '${duplicate}'`,
      );
    }
    for (const duplicate of duplicates(instructionTexts)) {
      addIssue(
        issues,
        'DUPLICATE_INFORMATION',
        '$.sections',
        `contains duplicate instruction text '${duplicate}'`,
      );
    }
  }
}
