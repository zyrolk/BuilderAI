import type {
  DecisionRecord,
  PendingWork,
  ProjectBrain,
  ProjectConstraint,
  ProjectGoal,
  ProjectTask,
} from '../../project-brain';
import type {
  ArchitectureAnalysis,
  BlueprintReadResult,
  DocumentDiagnostic,
  DocumentKind,
  ModuleAnalysis,
} from '../../blueprint-reader';
import type { ProjectFileSource } from '../ports/project-file-source';

export const CONTEXT_PACKAGE_SCHEMA_VERSION = 1 as const;

export const CONTEXT_PRIORITIES = [
  'PROJECT_CONSTITUTION',
  'PROJECT_BRAIN',
  'CURRENT_TASK',
  'ARCHITECTURE',
  'BLUEPRINT',
  'DECISION_LOG',
  'PROGRESS',
  'CODING_STANDARDS',
  'AI_RULES',
  'RELATED_SOURCE_FILES',
] as const;

export type ContextPriority = (typeof CONTEXT_PRIORITIES)[number];

export interface ContextLimits {
  readonly maxCharacters: number;
  readonly maxFiles: number;
  readonly maxDocuments: number;
  readonly maxSourcePaths: number;
  readonly maxSourceReads: number;
}

export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxCharacters: 50_000,
  maxFiles: 12,
  maxDocuments: 8,
  maxSourcePaths: 5_000,
  maxSourceReads: 24,
};

export interface ProjectSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface ContextBuildInput {
  readonly projectBrain: ProjectBrain;
  readonly blueprintReaderOutput: BlueprintReadResult;
  readonly currentTaskId: string;
  readonly sourceFileSource: ProjectFileSource;
}

export interface ProjectIdentityContext {
  readonly id: string;
  readonly name: string;
  readonly vision: string;
}

export interface ContextDocument {
  readonly kind: DocumentKind;
  readonly path: string;
  readonly priority: ContextPriority;
  readonly content: string;
}

export interface ContextSourceFile extends ProjectSourceFile {
  readonly priority: 'RELATED_SOURCE_FILES';
  readonly modulePath?: string;
}

export interface CodingStandardContext {
  readonly heading: string;
  readonly content: string;
}

export type ContextRiskSource = 'DOCUMENT_DIAGNOSTIC' | 'PENDING_WORK';

export interface ContextRisk {
  readonly id: string;
  readonly source: ContextRiskSource;
  readonly severity: 'WARNING' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly description: string;
}

export interface ContextBlocker {
  readonly taskId: string;
  readonly reason: string;
}

export type ContextOmissionReason = 'DUPLICATE' | 'DOCUMENT_LIMIT' | 'FILE_LIMIT' | 'SIZE_LIMIT';

export interface ContextOmission {
  readonly kind: 'DECISION' | 'DOCUMENT' | 'FILE' | 'MODULE';
  readonly identifier: string;
  readonly reason: ContextOmissionReason;
}

export interface ContextSize {
  readonly characters: number;
  readonly maxCharacters: number;
  readonly files: number;
  readonly maxFiles: number;
  readonly documents: number;
  readonly maxDocuments: number;
  readonly sourcePaths: number;
  readonly maxSourcePaths: number;
  readonly sourceReads: number;
  readonly maxSourceReads: number;
  readonly omissions: readonly ContextOmission[];
}

export interface ContextPackage {
  readonly schemaVersion: typeof CONTEXT_PACKAGE_SCHEMA_VERSION;
  readonly priorityOrder: readonly ContextPriority[];
  readonly projectIdentity: ProjectIdentityContext;
  readonly currentMilestone: string;
  readonly currentTask: ProjectTask;
  readonly relatedTasks: readonly ProjectTask[];
  readonly goals: readonly ProjectGoal[];
  readonly constraints: readonly ProjectConstraint[];
  readonly architectureSummary: ArchitectureAnalysis;
  readonly relevantModules: readonly ModuleAnalysis[];
  readonly relevantFiles: readonly ContextSourceFile[];
  readonly relevantDecisions: readonly DecisionRecord[];
  readonly codingStandards: readonly CodingStandardContext[];
  readonly knownRisks: readonly ContextRisk[];
  readonly openBlockers: readonly ContextBlocker[];
  readonly relevantDocumentation: readonly ContextDocument[];
  readonly size: ContextSize;
}

export type ContextValidationCode =
  | 'CONFLICTING_CONTEXT'
  | 'CONTEXT_SIZE_EXCEEDED'
  | 'DUPLICATE_CONTEXT'
  | 'INVALID_CONTEXT_LIMIT'
  | 'INVALID_REFERENCE'
  | 'MISSING_REQUIRED_CONTEXT';

export interface ContextValidationIssue {
  readonly code: ContextValidationCode;
  readonly path: string;
  readonly message: string;
}

export interface ContextSelection {
  readonly currentTask: ProjectTask;
  readonly relatedTasks: readonly ProjectTask[];
  readonly goals: readonly ProjectGoal[];
  readonly constraints: readonly ProjectConstraint[];
  readonly modules: readonly ModuleAnalysis[];
  readonly files: readonly ContextSourceFile[];
  readonly decisions: readonly DecisionRecord[];
  readonly codingStandards: readonly CodingStandardContext[];
  readonly risks: readonly ContextRisk[];
  readonly blockers: readonly ContextBlocker[];
  readonly documents: readonly ContextDocument[];
  readonly omissions: readonly ContextOmission[];
  readonly sourcePaths: number;
  readonly sourceReads: number;
}

export interface ValidatedContextInput {
  readonly brain: ProjectBrain;
  readonly reader: BlueprintReadResult & {
    readonly analysis: NonNullable<BlueprintReadResult['analysis']>;
    readonly summary: NonNullable<BlueprintReadResult['summary']>;
  };
  readonly currentTask: ProjectTask;
  readonly sourceFileSource: ProjectFileSource;
  readonly sourcePaths: readonly string[];
}

export function diagnosticRiskId(diagnostic: DocumentDiagnostic, index: number): string {
  return `${diagnostic.code.toLowerCase()}-${index + 1}`;
}

export function pendingWorkRiskId(work: PendingWork): string {
  return `pending-${work.id}`;
}
