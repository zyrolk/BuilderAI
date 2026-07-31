import { ContextBuilderService } from '../../context-builder';
import { createContextInput } from '../../context-builder/test/context-builder.fixture';
import { PromptOrchestratorService } from '../services';
import { DEFAULT_PROMPT_TEMPLATE } from '../templates';
import type { PromptPackage, PromptTemplate } from '../types';

export async function createPromptPackage(): Promise<PromptPackage> {
  const context = await new ContextBuilderService().build(await createContextInput());
  return new PromptOrchestratorService().build({
    context,
    metadata: { purpose: 'prompt-contract-test' },
  });
}

export function createTemplate(version = 1): PromptTemplate {
  return {
    ...structuredClone(DEFAULT_PROMPT_TEMPLATE),
    version,
    description: `BuilderAI prompt template version ${version}.`,
  };
}

export function recalculatePromptSize(packageValue: PromptPackage): PromptPackage {
  let characters = 0;
  let next = packageValue;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    next = { ...next, budget: { ...next.budget, characters } };
    const measured = JSON.stringify(next).length;
    if (measured === characters) return next;
    characters = measured;
  }
  return { ...next, budget: { ...next.budget, characters } };
}
