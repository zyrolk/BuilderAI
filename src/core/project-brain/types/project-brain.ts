export const PROJECT_BRAIN_SCHEMA_VERSION = 1 as const;

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DECISION_STATUSES = ['PROPOSED', 'ACCEPTED', 'SUPERSEDED', 'REJECTED'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const GLOSSARY_CATEGORIES = ['BUSINESS', 'TECHNICAL'] as const;
export type GlossaryCategory = (typeof GLOSSARY_CATEGORIES)[number];

export interface ProjectGoal {
  readonly id: string;
  readonly statement: string;
  readonly successCriteria: readonly string[];
}

export interface ProjectFeature {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
}

export interface ProjectRequirement {
  readonly id: string;
  readonly statement: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface ProjectConstraint {
  readonly id: string;
  readonly statement: string;
  readonly rationale: string;
}

export interface TechnologyChoice {
  readonly name: string;
  readonly version: string;
  readonly purpose: string;
}

export interface FolderOwnership {
  readonly path: string;
  readonly owner: string;
  readonly responsibility: string;
}

export interface ProjectBlueprint {
  readonly projectId: string;
  readonly name: string;
  readonly vision: string;
  readonly goals: readonly ProjectGoal[];
  readonly features: readonly ProjectFeature[];
  readonly requirements: readonly ProjectRequirement[];
  readonly constraints: readonly ProjectConstraint[];
  readonly techStack: readonly TechnologyChoice[];
  readonly folderOwnership: readonly FolderOwnership[];
}

export interface CompletedWork {
  readonly id: string;
  readonly summary: string;
  readonly taskIds: readonly string[];
  readonly completedAt: string;
}

export interface PendingWork {
  readonly id: string;
  readonly summary: string;
  readonly priority: TaskPriority;
}

export interface ArchitecturalRule {
  readonly id: string;
  readonly rule: string;
  readonly rationale: string;
}

export interface ProjectMemory {
  readonly completedWork: readonly CompletedWork[];
  readonly pendingWork: readonly PendingWork[];
  readonly importantDecisionIds: readonly string[];
  readonly architecturalRules: readonly ArchitecturalRule[];
  readonly updatedAt: string;
}

export interface DecisionConsequences {
  readonly positive: readonly string[];
  readonly negative: readonly string[];
}

export interface DecisionRecord {
  readonly id: string;
  readonly title: string;
  readonly context: string;
  readonly decision: string;
  readonly rationale: string;
  readonly status: DecisionStatus;
  readonly alternatives: readonly string[];
  readonly consequences: DecisionConsequences;
  readonly important: boolean;
  readonly recordedAt: string;
}

export interface CompletedSprint {
  readonly id: string;
  readonly name: string;
  readonly outcome: string;
  readonly completedTaskIds: readonly string[];
  readonly completedAt: string;
}

export interface ProgressLog {
  readonly currentMilestone: string;
  readonly completedSprints: readonly CompletedSprint[];
  readonly completedTaskIds: readonly string[];
  readonly updatedAt: string;
}

export interface ProjectTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly acceptanceCriteria: readonly string[];
  readonly dependencyIds: readonly string[];
  readonly blockerReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export interface GlossaryTerm {
  readonly id: string;
  readonly term: string;
  readonly category: GlossaryCategory;
  readonly definition: string;
  readonly aliases: readonly string[];
}

export interface DomainGlossary {
  readonly terms: readonly GlossaryTerm[];
  readonly updatedAt: string;
}

export interface ProjectBrain {
  readonly schemaVersion: typeof PROJECT_BRAIN_SCHEMA_VERSION;
  readonly blueprint: ProjectBlueprint;
  readonly memory: ProjectMemory;
  readonly decisionLog: readonly DecisionRecord[];
  readonly progressLog: ProgressLog;
  readonly tasks: readonly ProjectTask[];
  readonly domainGlossary: DomainGlossary;
}

export interface VersionedProjectBrain {
  readonly brain: ProjectBrain;
  readonly revision: number;
}
