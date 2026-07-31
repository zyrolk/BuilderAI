import {
  PromptOrchestratorValidationError,
  type PromptBudget,
  type PromptPackage,
  type PromptSection,
  type PromptSectionOmission,
} from '../types';

export type PromptPackageDraft = Omit<PromptPackage, 'budget'>;

export class PromptBudgetService {
  enforce(draft: PromptPackageDraft, maximumCharacters: number): PromptPackage {
    const sections = [...draft.sections];
    const omittedSections: PromptSectionOmission[] = [];

    while (true) {
      const packageValue = buildPackage(draft, sections, maximumCharacters, omittedSections);
      if (packageValue.budget.characters <= maximumCharacters) return packageValue;

      const optionalIndex = sections.findLastIndex(({ required }) => !required);
      const optionalSection = optionalIndex < 0 ? undefined : sections[optionalIndex];
      if (optionalSection === undefined) {
        throw new PromptOrchestratorValidationError([
          {
            code: 'PROMPT_SIZE_EXCEEDED',
            path: '$.maximumCharacters',
            message: `required prompt sections need ${packageValue.budget.characters} characters but the limit is ${maximumCharacters}`,
          },
        ]);
      }
      sections.splice(optionalIndex, 1);
      omittedSections.push({
        sectionId: optionalSection.id,
        kind: optionalSection.kind,
        reason: 'BUDGET_LIMIT',
        estimatedCharacters: JSON.stringify(optionalSection).length,
      });
    }
  }
}

function buildPackage(
  draft: PromptPackageDraft,
  sections: readonly PromptSection[],
  maximumCharacters: number,
  omittedSections: readonly PromptSectionOmission[],
): PromptPackage {
  let characters = 0;
  let packageValue: PromptPackage;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const budget: PromptBudget = { characters, maximumCharacters, omittedSections };
    packageValue = { ...draft, sections, budget };
    const measured = JSON.stringify(packageValue).length;
    if (measured === characters) return packageValue;
    characters = measured;
  }
  return {
    ...draft,
    sections,
    budget: { characters, maximumCharacters, omittedSections },
  };
}
