import type { PromptTemplateCatalog } from '../ports';
import type { PromptTemplate } from '../types';
import { DEFAULT_PROMPT_TEMPLATE } from './default-prompt-template';

export class StaticPromptTemplateCatalog implements PromptTemplateCatalog {
  constructor(private readonly templates: readonly PromptTemplate[] = [DEFAULT_PROMPT_TEMPLATE]) {}

  async listTemplates(): Promise<readonly PromptTemplate[]> {
    return structuredClone(this.templates);
  }
}
