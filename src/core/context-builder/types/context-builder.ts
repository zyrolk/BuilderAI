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
  'PINNED_BASELINE',
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

/**
 * `maxCharacters` is calibrated from real-repository measurement (P0-3, ADR-018), not an
 * arbitrary round number. Building a Context Package from the canonical Project Brain and a
 * realistic worst-case (4,000-character) task saturates at 83,833 characters once every relevant
 * file (up to `maxFiles`), document (up to `maxDocuments`), and relevance-scored decision is
 * included. 95,000 keeps that full candidate set intact with roughly 11,000 characters (~12%) of
 * reserved headroom for governance-content growth, while remaining safely below the Prompt
 * Orchestrator's `maximumCharacters` (see `MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS` in
 * `src/infrastructure/workspace/budget-invariant.ts`, which enforces the relationship at
 * composition time).
 */
export const DEFAULT_CONTEXT_LIMITS: ContextLimits = {
  maxCharacters: 95_000,
  maxFiles: 16,
  maxDocuments: 8,
  maxSourcePaths: 15_000,
  maxSourceReads: 36,
};

export interface SourceFileAdmissionQuotas {
  readonly implementation: number;
  readonly tests: number;
  readonly config: number;
}

/** Separate bounded quotas so tests and shared contracts can coexist with implementation files. */
export const DEFAULT_SOURCE_FILE_ADMISSION_QUOTAS: SourceFileAdmissionQuotas = {
  implementation: 11,
  tests: 4,
  config: 1,
};

/** Reserved headroom subtracted before source-file admission (ADR-018, ADR-023). */
export const CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS = 5_000;

export interface ProjectSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface ContextBuildInput {
  readonly projectBrain: ProjectBrain;
  readonly blueprintReaderOutput: BlueprintReadResult;
  readonly currentTaskId: string;
  readonly sourceFileSource: ProjectFileSource;
  readonly iterationPathHints?: readonly string[];
  readonly pinnedBaselineFiles?: readonly ContextSourceFile[];
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

export type ContextSourceFilePriority = 'PINNED_BASELINE' | 'RELATED_SOURCE_FILES';

export type ContextSelectionEvidenceKind =
  | 'EXPLICIT_PATH'
  | 'TASK_KEYWORD'
  | 'SOURCE_CATEGORY'
  | 'RELATED_IMPORT'
  | 'NEARBY_TEST'
  | 'DOMAIN_DIRECTORY'
  | 'BASENAME_AFFINITY'
  | 'PINNED_BASELINE';

export interface ContextSelectionEvidence {
  readonly kind: ContextSelectionEvidenceKind;
  readonly detail: string;
}

export interface ContextSourceFile extends ProjectSourceFile {
  readonly priority: ContextSourceFilePriority;
  readonly modulePath?: string;
  readonly selectionEvidence?: readonly ContextSelectionEvidence[];
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

export type ContextOmissionReason =
  | 'DUPLICATE'
  | 'DOCUMENT_LIMIT'
  | 'FILE_LIMIT'
  | 'SIZE_LIMIT'
  | 'BASELINE_UNAVAILABLE'
  | 'BASELINE_BUDGET_EXCEEDED';

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
  readonly iterationPathHints: readonly string[];
}

export function diagnosticRiskId(diagnostic: DocumentDiagnostic): string {
  return `diagnostic-${diagnostic.code.toLowerCase()}`;
}

export function pendingWorkRiskId(work: PendingWork): string {
  return `pending-${work.id}`;
}
