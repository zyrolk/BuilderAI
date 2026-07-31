import type { PromptTemplate } from '../types';

export interface PromptTemplateCatalog {
  listTemplates(): Promise<readonly PromptTemplate[]>;
}
