import {
  PromptOrchestratorValidationError,
  PromptTemplateNotFoundError,
  PromptTemplateSelectorService,
  PromptTemplateValidator,
  StaticPromptTemplateCatalog,
} from '..';
import { createTemplate } from './prompt-orchestrator.fixture';

describe('prompt template selection', () => {
  it('selects an exact template version', async () => {
    const selector = new PromptTemplateSelectorService();
    const selected = await selector.select(
      new StaticPromptTemplateCatalog([createTemplate(1), createTemplate(2)]),
      'builderai-standard',
      1,
    );
    expect(selected.version).toBe(1);
  });

  it('selects the latest version deterministically when no version is specified', async () => {
    const selected = await new PromptTemplateSelectorService().select(
      new StaticPromptTemplateCatalog([createTemplate(1), createTemplate(3), createTemplate(2)]),
      'builderai-standard',
    );
    expect(selected.version).toBe(3);
  });

  it('reports a missing requested template', async () => {
    await expect(
      new PromptTemplateSelectorService().select(
        new StaticPromptTemplateCatalog(),
        'missing-template',
      ),
    ).rejects.toBeInstanceOf(PromptTemplateNotFoundError);
  });

  it('rejects duplicate template identities and versions', async () => {
    await expect(
      new PromptTemplateSelectorService().select(
        new StaticPromptTemplateCatalog([createTemplate(), createTemplate()]),
        'builderai-standard',
      ),
    ).rejects.toBeInstanceOf(PromptOrchestratorValidationError);
  });

  it('rejects invalid template versions, ordering, requiredness, and duplicate instructions', () => {
    const template = createTemplate();
    const system = requiredValue(template.sections[0]);
    const architecture = requiredValue(template.sections[1]);
    const invalid = {
      ...template,
      schemaVersion: 2,
      sections: [
        { ...architecture, required: false },
        system,
        ...template.sections.slice(2),
        system,
      ],
    };
    expect(() => new PromptTemplateValidator().validate(invalid)).toThrow(
      PromptOrchestratorValidationError,
    );
  });

  it('rejects malformed template and section boundaries', () => {
    const validator = new PromptTemplateValidator();
    expect(() => validator.validate(null)).toThrow(PromptOrchestratorValidationError);
    expect(() => validator.validate({ ...createTemplate(), sections: null })).toThrow(
      PromptOrchestratorValidationError,
    );

    const template = createTemplate();
    const system = requiredValue(template.sections[0]);
    const context = requiredValue(template.sections[4]);
    expect(() =>
      validator.validate({
        ...template,
        id: 'Invalid ID',
        version: 0,
        description: '',
        providerRole: 'not-allowed',
        sections: [
          { ...system, instructions: [null, { id: '', text: '' }] },
          null,
          ...template.sections.slice(2, 4),
          { ...context, required: true, instructions: null },
          ...template.sections.slice(5),
        ],
      }),
    ).toThrow(PromptOrchestratorValidationError);
  });
});

function requiredValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test fixture value is missing.');
  return value;
}
