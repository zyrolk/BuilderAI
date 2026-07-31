import {
  PromptOrchestratorConfigurationValidator,
  PromptOrchestratorValidationError,
  PromptOutputContractValidator,
  PromptPackageValidator,
} from '..';
import { createPromptPackage, recalculatePromptSize } from './prompt-orchestrator.fixture';

function issueCodes(error: unknown): readonly string[] {
  return error instanceof PromptOrchestratorValidationError
    ? error.issues.map(({ code }) => code)
    : [];
}

describe('prompt package validation', () => {
  it('accepts the generated package and exact serialized budget', async () => {
    const packageValue = await createPromptPackage();
    expect(() => new PromptPackageValidator().validate(packageValue)).not.toThrow();
    expect(packageValue.budget.characters).toBe(JSON.stringify(packageValue).length);
  });

  it('rejects malformed packages and undeclared provider-specific fields', async () => {
    const validator = new PromptPackageValidator();
    expect(() => validator.validate(null)).toThrow(PromptOrchestratorValidationError);

    const packageValue = await createPromptPackage();
    const withUnknownField = {
      ...packageValue,
      providerSyntax: 'not-allowed',
    };
    expect(() => validator.validate(recalculatePromptSize(withUnknownField))).toThrow(
      PromptOrchestratorValidationError,
    );
  });

  it('detects duplicate sections and invalid ordering', async () => {
    const packageValue = await createPromptPackage();
    const architecture = requiredValue(packageValue.sections[1]);
    const system = requiredValue(packageValue.sections[0]);
    const invalid = recalculatePromptSize({
      ...packageValue,
      sections: [architecture, system, ...packageValue.sections],
    });
    try {
      new PromptPackageValidator().validate(invalid);
    } catch (error: unknown) {
      expect(issueCodes(error)).toEqual(
        expect.arrayContaining(['DUPLICATE_SECTION', 'INVALID_SECTION_ORDER']),
      );
    }
  });

  it('detects duplicate information and invalid references', async () => {
    const packageValue = await createPromptPackage();
    const taskIndex = packageValue.sections.findIndex(({ kind }) => kind === 'TASK');
    const contextIndex = packageValue.sections.findIndex(({ kind }) => kind === 'CONTEXT');
    const task = packageValue.sections[taskIndex];
    const context = packageValue.sections[contextIndex];
    expect(task?.kind).toBe('TASK');
    expect(context?.kind).toBe('CONTEXT');
    if (task?.kind !== 'TASK' || context?.kind !== 'CONTEXT') return;
    const firstGoal = requiredValue(task.goals[0]);
    const sections = [...packageValue.sections];
    sections[taskIndex] = { ...task, goals: [firstGoal, firstGoal] };
    sections[contextIndex] = {
      ...context,
      context: {
        ...context.context,
        openBlockers: [{ taskId: 'absent-task', reason: 'Missing task.' }],
      },
    };
    const invalid = recalculatePromptSize({ ...packageValue, sections });
    try {
      new PromptPackageValidator().validate(invalid);
    } catch (error: unknown) {
      expect(issueCodes(error)).toEqual(
        expect.arrayContaining(['DUPLICATE_INFORMATION', 'INVALID_REFERENCE']),
      );
    }
  });

  it('detects missing required sections and unrecorded optional omissions', async () => {
    const packageValue = await createPromptPackage();
    const missingSafety = recalculatePromptSize({
      ...packageValue,
      sections: packageValue.sections.filter(({ kind }) => kind !== 'SAFETY'),
    });
    expect(() => new PromptPackageValidator().validate(missingSafety)).toThrow(
      PromptOrchestratorValidationError,
    );

    const missingContext = recalculatePromptSize({
      ...packageValue,
      sections: packageValue.sections.filter(({ kind }) => kind !== 'CONTEXT'),
    });
    try {
      new PromptPackageValidator().validate(missingContext);
    } catch (error: unknown) {
      expect(issueCodes(error)).toContain('INVALID_PROMPT_STRUCTURE');
    }
  });

  it('detects invalid metadata, budget evidence, task dependencies, and module references', async () => {
    const packageValue = await createPromptPackage();
    const taskIndex = packageValue.sections.findIndex(({ kind }) => kind === 'TASK');
    const contextIndex = packageValue.sections.findIndex(({ kind }) => kind === 'CONTEXT');
    const task = packageValue.sections[taskIndex];
    const context = packageValue.sections[contextIndex];
    if (task?.kind !== 'TASK' || context?.kind !== 'CONTEXT') {
      throw new Error('Required prompt sections are missing from the fixture.');
    }
    const sections = [...packageValue.sections];
    sections[taskIndex] = {
      ...task,
      task: { ...task.task, dependencyIds: ['absent-dependency'] },
    };
    sections[contextIndex] = {
      ...context,
      context: {
        ...context.context,
        relevantFiles: context.context.relevantFiles.map((file, index) =>
          index === 0 ? { ...file, modulePath: 'absent-module' } : file,
        ),
      },
    };
    const invalid = recalculatePromptSize({
      ...packageValue,
      sections,
      metadata: {
        sourceContextSchemaVersion: 2,
        sourceContextCharacters: 0,
        values: { 'Invalid Key': Number.NaN },
      },
      budget: {
        ...packageValue.budget,
        omittedSections: [
          {
            sectionId: 'invalid',
            kind: 'SAFETY',
            reason: 'BUDGET_LIMIT',
            estimatedCharacters: 0,
          },
        ],
      },
    });
    try {
      new PromptPackageValidator().validate(invalid);
    } catch (error: unknown) {
      expect(issueCodes(error)).toEqual(
        expect.arrayContaining(['INVALID_PROMPT_STRUCTURE', 'INVALID_REFERENCE']),
      );
    }
  });
});

function requiredValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test fixture value is missing.');
  return value;
}

describe('prompt configuration and output contracts', () => {
  it('validates provider-neutral configuration and rejects undeclared fields', () => {
    const validator = new PromptOrchestratorConfigurationValidator();
    expect(() =>
      validator.validate({ templateId: 'builderai-standard', maximumCharacters: 10_000 }),
    ).not.toThrow();
    expect(() =>
      validator.validate({
        templateId: 'builderai-standard',
        maximumCharacters: 10_000,
        endpoint: 'not-allowed',
      }),
    ).toThrow(PromptOrchestratorValidationError);
    expect(() => validator.validate(null)).toThrow(PromptOrchestratorValidationError);
    expect(() =>
      validator.validate({ templateId: 'Invalid ID', templateVersion: 0, maximumCharacters: 0 }),
    ).toThrow(PromptOrchestratorValidationError);
  });

  it('validates the structured output contract and rejects duplicate or invalid fields', () => {
    const validator = new PromptOutputContractValidator();
    expect(() =>
      validator.validate({
        schemaVersion: 1,
        type: 'OBJECT',
        fields: [{ name: 'result', description: 'Result.', type: 'STRING', required: true }],
        allowAdditionalFields: false,
        providerFormat: 'not-allowed',
      }),
    ).toThrow(PromptOrchestratorValidationError);
    expect(() =>
      validator.validate({
        schemaVersion: 1,
        type: 'OBJECT',
        fields: [{ name: 'result', description: 'Result.', type: 'STRING', required: true }],
        allowAdditionalFields: false,
      }),
    ).not.toThrow();
    expect(() =>
      validator.validate({
        schemaVersion: 2,
        type: 'TEXT',
        fields: [
          { name: 'result', description: '', type: 'UNKNOWN', required: 'yes' },
          { name: 'result', description: 'Duplicate.', type: 'STRING', required: true },
        ],
        allowAdditionalFields: 'yes',
      }),
    ).toThrow(PromptOrchestratorValidationError);
    expect(() => validator.validate(null)).toThrow(PromptOrchestratorValidationError);
    expect(() =>
      validator.validate({
        schemaVersion: 1,
        type: 'OBJECT',
        fields: [],
        allowAdditionalFields: false,
      }),
    ).toThrow(PromptOrchestratorValidationError);
    expect(() =>
      validator.validate({
        schemaVersion: 1,
        type: 'OBJECT',
        fields: [null],
        allowAdditionalFields: false,
      }),
    ).toThrow(PromptOrchestratorValidationError);
  });
});
