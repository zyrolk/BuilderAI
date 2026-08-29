import type { ContextDocument, ContextPackage } from '../../context-builder';
import type { PreservationContractContent } from '../../update-scope';
import { renderPreservationContractText } from '../internal/preservation-contract-renderer';
import { renderPreservationRejectionText } from '../internal/preservation-rejection-renderer';
import type {
  PromptInstruction,
  PromptIterationContent,
  PromptOutputContract,
  PromptSection,
  PromptTemplate,
  PromptTemplateInstruction,
  PromptTemplateSection,
} from '../types';
import { normalizedContent } from '../validators/validation-helpers';

const CONTEXT_DOCUMENT_EXCLUSIONS = new Set([
  'project-brain',
  'project-constitution',
  'architecture',
  'coding-standards',
  'ai-rules',
]);

export class PromptSectionBuilder {
  build(
    template: PromptTemplate,
    context: ContextPackage,
    expectedOutput: PromptOutputContract,
    iterationFeedback?: PromptIterationContent,
    preservationContract?: PreservationContractContent,
    verificationPlanningText?: string,
  ): readonly PromptSection[] {
    const sections = template.sections.flatMap((section) => {
      const built = this.buildSection(
        section,
        context,
        expectedOutput,
        iterationFeedback,
        preservationContract,
        verificationPlanningText,
      );
      return built === undefined ? [] : [built];
    });
    return deduplicateInstructions(sections);
  }

  private buildSection(
    templateSection: PromptTemplateSection,
    context: ContextPackage,
    expectedOutput: PromptOutputContract,
    iterationFeedback?: PromptIterationContent,
    preservationContract?: PreservationContractContent,
    verificationPlanningText?: string,
  ): PromptSection | undefined {
    const base = {
      id: templateSection.id,
      required: templateSection.required,
    };
    switch (templateSection.kind) {
      case 'SYSTEM':
        return {
          ...base,
          kind: 'SYSTEM',
          identity: {
            projectId: context.projectIdentity.id,
            projectName: context.projectIdentity.name,
            vision: context.projectIdentity.vision,
            currentMilestone: context.currentMilestone,
          },
          instructions: [
            ...templateInstructions(templateSection.instructions),
            ...documentInstructions(context.relevantDocumentation, 'project-constitution'),
          ],
        };
      case 'ARCHITECTURE':
        return {
          ...base,
          kind: 'ARCHITECTURE',
          architecture: context.architectureSummary,
          modules: context.relevantModules,
        };
      case 'TASK':
        return {
          ...base,
          kind: 'TASK',
          task: context.currentTask,
          goals: context.goals,
          constraints: context.constraints,
        };
      case 'PRESERVATION_CONTRACT':
        if (preservationContract === undefined) return undefined;
        return {
          ...base,
          kind: 'PRESERVATION_CONTRACT',
          instructions: [
            ...templateInstructions(templateSection.instructions),
            {
              id: 'preservation-contract-body',
              text: renderPreservationContractText(preservationContract),
              source: 'TEMPLATE',
            },
          ],
          contract: preservationContract,
        };
      case 'ITERATION':
        if (iterationFeedback === undefined) return undefined;
        return {
          ...base,
          kind: 'ITERATION',
          instructions: [
            ...templateInstructions(templateSection.instructions),
            ...(iterationFeedback.preservationRejection === undefined
              ? []
              : [
                  {
                    id: 'preservation-rejection-feedback',
                    text: renderPreservationRejectionText(iterationFeedback.preservationRejection),
                    source: 'TEMPLATE' as const,
                  },
                ]),
          ],
          feedback: iterationFeedback,
        };
      case 'RULES':
        return {
          ...base,
          kind: 'RULES',
          instructions: [
            ...templateInstructions(templateSection.instructions),
            ...context.codingStandards.map((standard, index) => ({
              id: `coding-standard-${index + 1}`,
              text: `${standard.heading}: ${standard.content}`,
              source: 'CODING_STANDARD' as const,
              sourceReference: standard.heading,
            })),
            ...documentInstructions(context.relevantDocumentation, 'ai-rules'),
          ],
        };
      case 'CONTEXT':
        return {
          ...base,
          kind: 'CONTEXT',
          context: {
            relatedTasks: context.relatedTasks,
            relevantFiles: context.relevantFiles,
            relevantDecisions: context.relevantDecisions,
            knownRisks: context.knownRisks,
            openBlockers: context.openBlockers,
            relevantDocumentation: context.relevantDocumentation.filter(
              ({ kind }) => !CONTEXT_DOCUMENT_EXCLUSIONS.has(kind),
            ),
          },
        };
      case 'OUTPUT_CONTRACT':
        return { ...base, kind: 'OUTPUT_CONTRACT', expectedOutput };
      case 'SAFETY':
        return {
          ...base,
          kind: 'SAFETY',
          instructions: [
            ...templateInstructions(templateSection.instructions),
            ...(verificationPlanningText === undefined
              ? []
              : [
                  {
                    id: 'verification-baseline-planning-data',
                    text: verificationPlanningText,
                    source: 'TEMPLATE' as const,
                  },
                ]),
          ],
        };
    }
  }
}

function templateInstructions(
  instructions: readonly PromptTemplateInstruction[],
): readonly PromptInstruction[] {
  return instructions.map((instruction) => ({
    ...instruction,
    source: 'TEMPLATE',
  }));
}

function documentInstructions(
  documents: readonly ContextDocument[],
  kind: ContextDocument['kind'],
): readonly PromptInstruction[] {
  return documents
    .filter((document) => document.kind === kind)
    .map((document) => ({
      id: `document-${document.kind}`,
      text: document.content,
      source: 'DOCUMENT',
      sourceReference: document.path,
    }));
}

function deduplicateInstructions(sections: readonly PromptSection[]): readonly PromptSection[] {
  const ids = new Set<string>();
  const contents = new Set<string>();
  return sections.map((section) => {
    if (section.kind !== 'SYSTEM' && section.kind !== 'RULES' && section.kind !== 'SAFETY') {
      return section;
    }
    const instructions = section.instructions.filter((instruction) => {
      const content = normalizedContent(instruction.text);
      if (ids.has(instruction.id) || contents.has(content)) return false;
      ids.add(instruction.id);
      contents.add(content);
      return true;
    });
    return { ...section, instructions };
  });
}
