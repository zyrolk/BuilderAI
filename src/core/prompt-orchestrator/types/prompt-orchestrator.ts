import type { ContextPackage } from '../../context-builder';
import type { ProjectConstraint, ProjectGoal, ProjectTask } from '../../project-brain';

export const PROMPT_PACKAGE_SCHEMA_VERSION = 1 as const;
export const PROMPT_TEMPLATE_SCHEMA_VERSION = 1 as const;
export const PROMPT_OUTPUT_CONTRACT_SCHEMA_VERSION = 1 as const;

export const PROMPT_SECTION_ORDER = [
  'SYSTEM',
  'ARCHITECTURE',
  'TASK',
  'RULES',
  'CONTEXT',
  'OUTPUT_CONTRACT',
  'SAFETY',
] as const;

export type PromptSectionKind = (typeof PROMPT_SECTION_ORDER)[number];

export interface PromptTemplateInstruction {
  readonly id: string;
  readonly text: string;
}

export interface PromptTemplateSection {
  readonly id: string;
  readonly kind: PromptSectionKind;
  readonly required: boolean;
  readonly instructions: readonly PromptTemplateInstruction[];
}

export interface PromptTemplate {
  readonly schemaVersion: typeof PROMPT_TEMPLATE_SCHEMA_VERSION;
  readonly id: string;
  readonly version: number;
  readonly description: string;
  readonly sections: readonly PromptTemplateSection[];
}

export type PromptMetadataValue = string | number | boolean;
export type PromptMetadata = Readonly<Record<string, PromptMetadataValue>>;

export interface PromptIdentity {
  readonly projectId: string;
  readonly projectName: string;
  readonly vision: string;
  readonly currentMilestone: string;
}

export type PromptInstructionSource = 'TEMPLATE' | 'DOCUMENT' | 'CODING_STANDARD';

export interface PromptInstruction {
  readonly id: string;
  readonly text: string;
  readonly source: PromptInstructionSource;
  readonly sourceReference?: string;
}

interface PromptSectionBase {
  readonly id: string;
  readonly kind: PromptSectionKind;
  readonly required: boolean;
}

export interface PromptSystemSection extends PromptSectionBase {
  readonly kind: 'SYSTEM';
  readonly identity: PromptIdentity;
  readonly instructions: readonly PromptInstruction[];
}

export interface PromptArchitectureSection extends PromptSectionBase {
  readonly kind: 'ARCHITECTURE';
  readonly architecture: ContextPackage['architectureSummary'];
  readonly modules: ContextPackage['relevantModules'];
}

export interface PromptTaskSection extends PromptSectionBase {
  readonly kind: 'TASK';
  readonly task: ProjectTask;
  readonly goals: readonly ProjectGoal[];
  readonly constraints: readonly ProjectConstraint[];
}

export interface PromptRulesSection extends PromptSectionBase {
  readonly kind: 'RULES';
  readonly instructions: readonly PromptInstruction[];
}

export interface PromptContextContent {
  readonly relatedTasks: ContextPackage['relatedTasks'];
  readonly relevantFiles: ContextPackage['relevantFiles'];
  readonly relevantDecisions: ContextPackage['relevantDecisions'];
  readonly knownRisks: ContextPackage['knownRisks'];
  readonly openBlockers: ContextPackage['openBlockers'];
  readonly relevantDocumentation: ContextPackage['relevantDocumentation'];
}

export interface PromptContextSection extends PromptSectionBase {
  readonly kind: 'CONTEXT';
  readonly context: PromptContextContent;
}

export const PROMPT_OUTPUT_FIELD_TYPES = [
  'STRING',
  'NUMBER',
  'BOOLEAN',
  'OBJECT',
  'ARRAY',
] as const;
export type PromptOutputFieldType = (typeof PROMPT_OUTPUT_FIELD_TYPES)[number];

export interface PromptOutputField {
  readonly name: string;
  readonly description: string;
  readonly type: PromptOutputFieldType;
  readonly required: boolean;
}

export interface PromptOutputContract {
  readonly schemaVersion: typeof PROMPT_OUTPUT_CONTRACT_SCHEMA_VERSION;
  readonly type: 'OBJECT';
  readonly fields: readonly PromptOutputField[];
  readonly allowAdditionalFields: boolean;
}

export interface PromptOutputContractSection extends PromptSectionBase {
  readonly kind: 'OUTPUT_CONTRACT';
  readonly expectedOutput: PromptOutputContract;
}

export interface PromptSafetySection extends PromptSectionBase {
  readonly kind: 'SAFETY';
  readonly instructions: readonly PromptInstruction[];
}

export type PromptSection =
  | PromptSystemSection
  | PromptArchitectureSection
  | PromptTaskSection
  | PromptRulesSection
  | PromptContextSection
  | PromptOutputContractSection
  | PromptSafetySection;

export type PromptOmissionReason = 'BUDGET_LIMIT';

export interface PromptSectionOmission {
  readonly sectionId: string;
  readonly kind: PromptSectionKind;
  readonly reason: PromptOmissionReason;
  readonly estimatedCharacters: number;
}

export interface PromptBudget {
  readonly characters: number;
  readonly maximumCharacters: number;
  readonly omittedSections: readonly PromptSectionOmission[];
}

export interface PromptPackageMetadata {
  readonly sourceContextSchemaVersion: number;
  readonly sourceContextCharacters: number;
  readonly values: PromptMetadata;
}

export interface PromptPackage {
  readonly schemaVersion: typeof PROMPT_PACKAGE_SCHEMA_VERSION;
  readonly template: {
    readonly id: string;
    readonly version: number;
  };
  readonly sections: readonly PromptSection[];
  readonly metadata: PromptPackageMetadata;
  readonly budget: PromptBudget;
}

export interface PromptBuildInput {
  readonly context: ContextPackage;
  readonly expectedOutput?: PromptOutputContract;
  readonly metadata?: PromptMetadata;
}

export type PromptValidationCode =
  | 'DUPLICATE_INFORMATION'
  | 'DUPLICATE_SECTION'
  | 'INVALID_OUTPUT_CONTRACT'
  | 'INVALID_PROMPT_STRUCTURE'
  | 'INVALID_REFERENCE'
  | 'INVALID_SECTION_ORDER'
  | 'INVALID_TEMPLATE'
  | 'MISSING_REQUIRED_SECTION'
  | 'PROMPT_SIZE_EXCEEDED'
  | 'UNSUPPORTED_PROMPT_VERSION';

export interface PromptValidationIssue {
  readonly code: PromptValidationCode;
  readonly path: string;
  readonly message: string;
}
