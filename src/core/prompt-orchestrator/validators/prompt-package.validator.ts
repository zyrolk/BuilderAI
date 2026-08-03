import {
  PROMPT_PACKAGE_SCHEMA_VERSION,
  PROMPT_SECTION_ORDER,
  PromptOrchestratorValidationError,
  type PromptInstruction,
  type PromptPackage,
  type PromptSection,
  type PromptSectionKind,
  type PromptValidationIssue,
} from '../types';
import { PromptOutputContractValidator } from './output-contract.validator';
import {
  addIssue,
  duplicates,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  normalizedContent,
  PROMPT_IDENTIFIER_PATTERN,
  validateExactKeys,
  validateMetadata,
} from './validation-helpers';

const REQUIRED_SECTION_KINDS: readonly PromptSectionKind[] = [
  'SYSTEM',
  'ARCHITECTURE',
  'TASK',
  'RULES',
  'OUTPUT_CONTRACT',
  'SAFETY',
];

export class PromptPackageValidator {
  private readonly outputValidator: PromptOutputContractValidator =
    new PromptOutputContractValidator();

  validate(value: unknown): void {
    const issues: PromptValidationIssue[] = [];
    if (!hasPromptPackageStructure(value)) {
      throw new PromptOrchestratorValidationError([
        {
          code: 'INVALID_PROMPT_STRUCTURE',
          path: '$',
          message: 'must be a Prompt Package with complete section and budget structure',
        },
      ]);
    }
    this.validateExactStructure(value, issues);
    if (value.schemaVersion !== PROMPT_PACKAGE_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_PROMPT_VERSION',
        '$.schemaVersion',
        `must equal ${PROMPT_PACKAGE_SCHEMA_VERSION}`,
      );
    }
    if (!PROMPT_IDENTIFIER_PATTERN.test(value.template.id)) {
      addIssue(issues, 'INVALID_PROMPT_STRUCTURE', '$.template.id', 'has an invalid identifier');
    }
    if (!isPositiveSafeInteger(value.template.version)) {
      addIssue(
        issues,
        'UNSUPPORTED_PROMPT_VERSION',
        '$.template.version',
        'must be a positive safe integer',
      );
    }
    this.validateSections(value, issues);
    this.validateMetadata(value, issues);
    this.validateBudget(value, issues);
    if (issues.length > 0) throw new PromptOrchestratorValidationError(issues);
  }

  private validateExactStructure(value: PromptPackage, issues: PromptValidationIssue[]): void {
    validateExactKeys(
      value,
      ['schemaVersion', 'template', 'sections', 'metadata', 'budget'],
      '$',
      issues,
    );
    validateExactKeys(value.template, ['id', 'version'], '$.template', issues);
    validateExactKeys(
      value.metadata,
      ['sourceContextSchemaVersion', 'sourceContextCharacters', 'values'],
      '$.metadata',
      issues,
    );
    validateExactKeys(
      value.budget,
      ['characters', 'maximumCharacters', 'omittedSections'],
      '$.budget',
      issues,
    );
    value.budget.omittedSections.forEach((omission, index) =>
      validateExactKeys(
        omission,
        ['sectionId', 'kind', 'reason', 'estimatedCharacters'],
        `$.budget.omittedSections[${index}]`,
        issues,
      ),
    );
    value.sections.forEach((section, index) => {
      const path = `$.sections[${index}]`;
      const common = ['id', 'kind', 'required'];
      switch (section.kind) {
        case 'SYSTEM':
          validateExactKeys(section, [...common, 'identity', 'instructions'], path, issues);
          validateExactKeys(
            section.identity,
            ['projectId', 'projectName', 'vision', 'currentMilestone'],
            `${path}.identity`,
            issues,
          );
          this.validateInstructionKeys(section.instructions, `${path}.instructions`, issues);
          break;
        case 'ARCHITECTURE':
          validateExactKeys(section, [...common, 'architecture', 'modules'], path, issues);
          break;
        case 'TASK':
          validateExactKeys(section, [...common, 'task', 'goals', 'constraints'], path, issues);
          break;
        case 'ITERATION':
          validateExactKeys(section, [...common, 'instructions', 'feedback'], path, issues);
          this.validateInstructionKeys(section.instructions, `${path}.instructions`, issues);
          break;
        case 'RULES':
        case 'SAFETY':
          validateExactKeys(section, [...common, 'instructions'], path, issues);
          this.validateInstructionKeys(section.instructions, `${path}.instructions`, issues);
          break;
        case 'CONTEXT':
          validateExactKeys(section, [...common, 'context'], path, issues);
          validateExactKeys(
            section.context,
            [
              'relatedTasks',
              'relevantFiles',
              'relevantDecisions',
              'knownRisks',
              'openBlockers',
              'relevantDocumentation',
            ],
            `${path}.context`,
            issues,
          );
          break;
        case 'OUTPUT_CONTRACT':
          validateExactKeys(section, [...common, 'expectedOutput'], path, issues);
          break;
      }
    });
  }

  private validateInstructionKeys(
    instructions: readonly PromptInstruction[],
    path: string,
    issues: PromptValidationIssue[],
  ): void {
    instructions.forEach((instruction, index) =>
      validateExactKeys(
        instruction,
        ['id', 'text', 'source', 'sourceReference'],
        `${path}[${index}]`,
        issues,
      ),
    );
  }

  private validateSections(value: PromptPackage, issues: PromptValidationIssue[]): void {
    const ids = value.sections.map(({ id }) => id);
    const kinds = value.sections.map(({ kind }) => kind);
    for (const duplicate of duplicates(ids)) {
      addIssue(issues, 'DUPLICATE_SECTION', '$.sections', `contains duplicate id '${duplicate}'`);
    }
    for (const duplicate of duplicates(kinds)) {
      addIssue(issues, 'DUPLICATE_SECTION', '$.sections', `contains duplicate kind '${duplicate}'`);
    }
    for (const requiredKind of REQUIRED_SECTION_KINDS) {
      if (!kinds.includes(requiredKind)) {
        addIssue(issues, 'MISSING_REQUIRED_SECTION', '$.sections', `is missing '${requiredKind}'`);
      }
    }
    let previousRank = -1;
    for (const section of value.sections) {
      const rank = PROMPT_SECTION_ORDER.indexOf(section.kind);
      if (rank < 0 || rank <= previousRank) {
        addIssue(
          issues,
          'INVALID_SECTION_ORDER',
          '$.sections',
          'does not follow the canonical stable order',
        );
        break;
      }
      previousRank = rank;
      if (!isNonEmptyString(section.id)) {
        addIssue(issues, 'INVALID_PROMPT_STRUCTURE', '$.sections.id', 'is required');
      }
      if (section.kind !== 'CONTEXT' && section.kind !== 'ITERATION' && !section.required) {
        addIssue(
          issues,
          'MISSING_REQUIRED_SECTION',
          `$.sections.${section.id}.required`,
          'must be true',
        );
      }
      if (section.kind === 'CONTEXT' && section.required) {
        addIssue(
          issues,
          'INVALID_PROMPT_STRUCTURE',
          `$.sections.${section.id}.required`,
          'must be false',
        );
      }
      if (section.kind === 'ITERATION' && section.required) {
        addIssue(
          issues,
          'INVALID_PROMPT_STRUCTURE',
          `$.sections.${section.id}.required`,
          'must be false',
        );
      }
    }
    this.validateInformation(value.sections, issues);
    this.validateReferences(value.sections, issues);

    const outputSection = value.sections.find(({ kind }) => kind === 'OUTPUT_CONTRACT');
    if (outputSection?.kind === 'OUTPUT_CONTRACT') {
      try {
        this.outputValidator.validate(outputSection.expectedOutput);
      } catch (error: unknown) {
        if (error instanceof PromptOrchestratorValidationError) {
          for (const issue of error.issues) {
            issues.push({ ...issue, path: `$.sections.output-contract${issue.path.slice(1)}` });
          }
        }
      }
    }
  }

  private validateInformation(
    sections: readonly PromptSection[],
    issues: PromptValidationIssue[],
  ): void {
    const instructionSections = sections.filter(
      (section): section is Extract<PromptSection, { kind: 'SYSTEM' | 'RULES' | 'SAFETY' }> =>
        section.kind === 'SYSTEM' || section.kind === 'RULES' || section.kind === 'SAFETY',
    );
    const instructions: PromptInstruction[] = instructionSections.flatMap((section) => [
      ...section.instructions,
    ]);
    for (const duplicate of duplicates(instructions.map(({ id }) => id))) {
      addIssue(
        issues,
        'DUPLICATE_INFORMATION',
        '$.sections',
        `contains duplicate instruction id '${duplicate}'`,
      );
    }
    for (const duplicate of duplicates(
      instructions.map(({ text }) => normalizedContent(text)).filter(Boolean),
    )) {
      addIssue(
        issues,
        'DUPLICATE_INFORMATION',
        '$.sections',
        `contains duplicate instruction content '${duplicate}'`,
      );
    }

    const taskSection = sections.find(({ kind }) => kind === 'TASK');
    if (taskSection?.kind === 'TASK') {
      this.addDuplicates(
        taskSection.goals.map(({ id }) => id),
        '$.sections.task.goals',
        issues,
      );
      this.addDuplicates(
        taskSection.constraints.map(({ id }) => id),
        '$.sections.task.constraints',
        issues,
      );
    }
    const architecture = sections.find(({ kind }) => kind === 'ARCHITECTURE');
    if (architecture?.kind === 'ARCHITECTURE') {
      this.addDuplicates(
        architecture.modules.map(({ path }) => path),
        '$.sections.architecture.modules',
        issues,
      );
    }
    const context = sections.find(({ kind }) => kind === 'CONTEXT');
    if (context?.kind === 'CONTEXT') {
      this.addDuplicates(
        context.context.relatedTasks.map(({ id }) => id),
        '$.sections.context.relatedTasks',
        issues,
      );
      this.addDuplicates(
        context.context.relevantFiles.map(({ path }) => path),
        '$.sections.context.relevantFiles',
        issues,
      );
      this.addDuplicates(
        context.context.relevantDecisions.map(({ id }) => id),
        '$.sections.context.relevantDecisions',
        issues,
      );
      this.addDuplicates(
        context.context.relevantDocumentation.map(({ path }) => path),
        '$.sections.context.relevantDocumentation',
        issues,
      );
    }
  }

  private validateReferences(
    sections: readonly PromptSection[],
    issues: PromptValidationIssue[],
  ): void {
    const task = sections.find(({ kind }) => kind === 'TASK');
    const context = sections.find(({ kind }) => kind === 'CONTEXT');
    const architecture = sections.find(({ kind }) => kind === 'ARCHITECTURE');
    if (task?.kind !== 'TASK' || context?.kind !== 'CONTEXT') return;

    const taskIds = new Set([task.task.id, ...context.context.relatedTasks.map(({ id }) => id)]);
    for (const projectTask of [task.task, ...context.context.relatedTasks]) {
      for (const dependencyId of projectTask.dependencyIds) {
        if (!taskIds.has(dependencyId)) {
          addIssue(
            issues,
            'INVALID_REFERENCE',
            '$.sections.context.relatedTasks',
            `task '${projectTask.id}' references absent dependency '${dependencyId}'`,
          );
        }
      }
    }
    for (const blocker of context.context.openBlockers) {
      if (!taskIds.has(blocker.taskId)) {
        addIssue(
          issues,
          'INVALID_REFERENCE',
          '$.sections.context.openBlockers',
          `references absent task '${blocker.taskId}'`,
        );
      }
    }
    if (architecture?.kind === 'ARCHITECTURE') {
      const modulePaths = new Set(architecture.modules.map(({ path }) => path));
      for (const file of context.context.relevantFiles) {
        if (file.modulePath !== undefined && !modulePaths.has(file.modulePath)) {
          addIssue(
            issues,
            'INVALID_REFERENCE',
            '$.sections.context.relevantFiles',
            `file '${file.path}' references absent module '${file.modulePath}'`,
          );
        }
      }
    }
  }

  private validateMetadata(value: PromptPackage, issues: PromptValidationIssue[]): void {
    if (value.metadata.sourceContextSchemaVersion !== 1) {
      addIssue(
        issues,
        'INVALID_PROMPT_STRUCTURE',
        '$.metadata.sourceContextSchemaVersion',
        'must equal the supported Context Package version',
      );
    }
    if (!isPositiveSafeInteger(value.metadata.sourceContextCharacters)) {
      addIssue(
        issues,
        'INVALID_PROMPT_STRUCTURE',
        '$.metadata.sourceContextCharacters',
        'must be a positive safe integer',
      );
    }
    validateMetadata(value.metadata.values, '$.metadata.values', issues);
  }

  private validateBudget(value: PromptPackage, issues: PromptValidationIssue[]): void {
    if (
      !isPositiveSafeInteger(value.budget.maximumCharacters) ||
      !isNonNegativeSafeInteger(value.budget.characters)
    ) {
      addIssue(issues, 'INVALID_PROMPT_STRUCTURE', '$.budget', 'contains invalid character limits');
    }
    if (value.budget.characters > value.budget.maximumCharacters) {
      addIssue(issues, 'PROMPT_SIZE_EXCEEDED', '$.budget.characters', 'exceeds maximumCharacters');
    }
    if (value.budget.characters !== JSON.stringify(value).length) {
      addIssue(
        issues,
        'INVALID_PROMPT_STRUCTURE',
        '$.budget.characters',
        'must equal the serialized Prompt Package size',
      );
    }
    this.addDuplicates(
      value.budget.omittedSections.map(({ sectionId }) => sectionId),
      '$.budget.omittedSections',
      issues,
    );
    const contextPresent = value.sections.some(({ kind }) => kind === 'CONTEXT');
    const contextOmitted = value.budget.omittedSections.some(({ kind }) => kind === 'CONTEXT');
    if (contextPresent === contextOmitted) {
      addIssue(
        issues,
        'INVALID_PROMPT_STRUCTURE',
        '$.budget.omittedSections',
        'must record CONTEXT exactly when that optional section is absent',
      );
    }
    for (const omission of value.budget.omittedSections) {
      if (
        omission.kind !== 'CONTEXT' ||
        omission.reason !== 'BUDGET_LIMIT' ||
        !isPositiveSafeInteger(omission.estimatedCharacters)
      ) {
        addIssue(
          issues,
          'INVALID_PROMPT_STRUCTURE',
          '$.budget.omittedSections',
          'contains an invalid optional-section omission',
        );
      }
    }
  }

  private addDuplicates(
    values: readonly string[],
    path: string,
    issues: PromptValidationIssue[],
  ): void {
    for (const duplicate of duplicates(values)) {
      addIssue(issues, 'DUPLICATE_INFORMATION', path, `contains duplicate '${duplicate}'`);
    }
  }
}

function hasPromptPackageStructure(value: unknown): value is PromptPackage {
  if (
    !isRecord(value) ||
    !isRecord(value.template) ||
    !Array.isArray(value.sections) ||
    !isRecord(value.metadata) ||
    !isRecord(value.metadata.values) ||
    !isRecord(value.budget) ||
    !Array.isArray(value.budget.omittedSections) ||
    !value.budget.omittedSections.every(isRecord)
  ) {
    return false;
  }
  return value.sections.every(hasPromptSectionStructure);
}

function hasPromptSectionStructure(value: unknown): value is PromptSection {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.kind !== 'string' ||
    typeof value.required !== 'boolean'
  ) {
    return false;
  }
  switch (value.kind) {
    case 'SYSTEM':
      return isRecord(value.identity) && hasInstructionArray(value.instructions);
    case 'ARCHITECTURE':
      return isRecord(value.architecture) && hasRecordArray(value.modules);
    case 'TASK':
      return (
        isRecord(value.task) &&
        Array.isArray(value.task.dependencyIds) &&
        hasRecordArray(value.goals) &&
        hasRecordArray(value.constraints)
      );
    case 'RULES':
    case 'SAFETY':
      return hasInstructionArray(value.instructions);
    case 'CONTEXT':
      return (
        isRecord(value.context) &&
        hasTaskArray(value.context.relatedTasks) &&
        hasRecordArray(value.context.relevantFiles) &&
        hasRecordArray(value.context.relevantDecisions) &&
        hasRecordArray(value.context.knownRisks) &&
        hasRecordArray(value.context.openBlockers) &&
        hasRecordArray(value.context.relevantDocumentation)
      );
    case 'ITERATION':
      return hasInstructionArray(value.instructions) && isRecord(value.feedback);
    case 'OUTPUT_CONTRACT':
      return isRecord(value.expectedOutput);
    default:
      return false;
  }
}

function hasInstructionArray(value: unknown): value is readonly PromptInstruction[] {
  return (
    Array.isArray(value) &&
    value.every(
      (instruction) =>
        isRecord(instruction) &&
        typeof instruction.id === 'string' &&
        typeof instruction.text === 'string',
    )
  );
}

function hasRecordArray(value: unknown): value is readonly Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function hasTaskArray(value: unknown): value is readonly Record<string, unknown>[] {
  return hasRecordArray(value) && value.every((task) => Array.isArray(task.dependencyIds));
}
