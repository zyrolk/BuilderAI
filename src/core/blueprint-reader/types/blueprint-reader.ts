import type {
  CompletedWork,
  PendingWork,
  ProjectConstraint,
  ProjectFeature,
  ProjectGoal,
  ProjectRequirement,
  TechnologyChoice,
} from '../../project-brain';

export const DOCUMENT_KINDS = [
  'project-brain',
  'project-constitution',
  'project-blueprint',
  'project-memory',
  'decision-log',
  'progress-log',
  'task-system',
  'domain-glossary',
  'architecture',
  'roadmap',
  'coding-standards',
  'ai-rules',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type DocumentFormat = 'JSON' | 'MARKDOWN';
export type DiagnosticSeverity = 'ERROR' | 'WARNING';

export type DiagnosticCode =
  | 'CONFLICTING_INFORMATION'
  | 'DUPLICATE_DOCUMENT'
  | 'DUPLICATED_MUTABLE_STATE'
  | 'INVALID_DOCUMENT_METADATA'
  | 'MALFORMED_DOCUMENT'
  | 'MISSING_DOCUMENT'
  | 'MISSING_REFERENCE'
  | 'MISSING_SECTION'
  | 'SCHEMA_INCOMPATIBLE'
  | 'UNKNOWN_DOCUMENT'
  | 'UNSUPPORTED_DOCUMENT_VERSION';

export interface DocumentDiagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly path?: string;
  readonly relatedPaths?: readonly string[];
}

export interface RequiredDocumentSpec {
  readonly kind: DocumentKind;
  readonly path: string;
  readonly format: DocumentFormat;
  readonly supportedVersions: readonly number[];
  readonly requiredSections: readonly string[];
}

export interface DiscoveredDocument {
  readonly kind: DocumentKind;
  readonly expectedPath: string;
  readonly actualPath: string;
  readonly format: DocumentFormat;
}

export interface DuplicateDocument {
  readonly kind: DocumentKind;
  readonly paths: readonly string[];
}

export interface DiscoveryReport {
  readonly documents: readonly DiscoveredDocument[];
  readonly missing: readonly RequiredDocumentSpec[];
  readonly duplicates: readonly DuplicateDocument[];
  readonly unknown: readonly string[];
  readonly diagnostics: readonly DocumentDiagnostic[];
}

export interface MarkdownSection {
  readonly heading: string;
  readonly normalizedHeading: string;
  readonly level: number;
  readonly content: string;
}

export interface ParsedMarkdownDocument {
  readonly kind: DocumentKind;
  readonly path: string;
  readonly declaredKind?: string;
  readonly version?: number;
  readonly title?: string;
  readonly content: string;
  readonly sections: readonly MarkdownSection[];
}

export interface ArchitectureAnalysis {
  readonly scope: string;
  readonly principles: readonly string[];
}

export interface ModuleAnalysis {
  readonly path: string;
  readonly owner: string;
  readonly responsibility: string;
}

export interface MilestoneAnalysis {
  readonly current: string;
  readonly completed: readonly {
    readonly id: string;
    readonly name: string;
    readonly outcome: string;
  }[];
}

export interface BlueprintAnalysis {
  readonly projectId: string;
  readonly projectName: string;
  readonly vision: string;
  readonly goals: readonly ProjectGoal[];
  readonly architecture: ArchitectureAnalysis;
  readonly modules: readonly ModuleAnalysis[];
  readonly milestones: MilestoneAnalysis;
  readonly features: readonly ProjectFeature[];
  readonly requirements: readonly ProjectRequirement[];
  readonly constraints: readonly ProjectConstraint[];
  readonly techStack: readonly TechnologyChoice[];
}

export type RelationshipKind =
  'COMPLETED_BY' | 'DEPENDS_ON' | 'DOCUMENTS' | 'GOVERNS' | 'REFERENCES';

export interface ProjectRelationship {
  readonly from: string;
  readonly to: string;
  readonly kind: RelationshipKind;
}

export interface ProjectSummary {
  readonly projectOverview: {
    readonly id: string;
    readonly name: string;
    readonly vision: string;
    readonly goals: readonly ProjectGoal[];
    readonly techStack: readonly TechnologyChoice[];
  };
  readonly architectureOverview: ArchitectureAnalysis;
  readonly moduleList: readonly ModuleAnalysis[];
  readonly featureList: readonly ProjectFeature[];
  readonly currentMilestone: string;
  readonly pendingWork: readonly PendingWork[];
  readonly completedWork: readonly CompletedWork[];
  readonly risks: readonly DocumentDiagnostic[];
  readonly missingDocumentation: readonly string[];
}

export interface BlueprintReadResult {
  readonly valid: boolean;
  readonly discovery: DiscoveryReport;
  readonly documents: readonly ParsedMarkdownDocument[];
  readonly analysis?: BlueprintAnalysis;
  readonly relationships: readonly ProjectRelationship[];
  readonly diagnostics: readonly DocumentDiagnostic[];
  readonly summary?: ProjectSummary;
}
