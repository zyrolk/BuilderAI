import type { PromptTemplateCatalog } from '../ports';
import {
  PromptOrchestratorValidationError,
  PromptTemplateNotFoundError,
  type PromptTemplate,
} from '../types';
import { PromptTemplateValidator } from '../validators';

export class PromptTemplateSelectorService {
  private readonly validator: PromptTemplateValidator = new PromptTemplateValidator();

  async select(
    catalog: PromptTemplateCatalog,
    templateId: string,
    templateVersion?: number,
  ): Promise<PromptTemplate> {
    const templates = await catalog.listTemplates();
    for (const template of templates) this.validator.validate(template);

    const keys = templates.map(({ id, version }) => `${id}@${version}`);
    const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
    if (duplicate !== undefined) {
      throw new PromptOrchestratorValidationError([
        {
          code: 'INVALID_TEMPLATE',
          path: '$.templates',
          message: `contains duplicate '${duplicate}'`,
        },
      ]);
    }

    const candidates = templates
      .filter(
        (template) =>
          template.id === templateId &&
          (templateVersion === undefined || template.version === templateVersion),
      )
      .sort((left, right) => right.version - left.version);
    const selected = candidates[0];
    if (selected === undefined) throw new PromptTemplateNotFoundError(templateId, templateVersion);
    return structuredClone(selected);
  }
}
