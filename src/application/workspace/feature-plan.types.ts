export const FEATURE_PLAN_SCHEMA_VERSION = 1 as const;

export const FEATURE_PLAN_STATUSES = [
  'DRAFT',
  'APPROVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export const FEATURE_TASK_STATUSES = [
  'PENDING',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'SKIPPED',
] as const;

export type FeaturePlanStatus = (typeof FEATURE_PLAN_STATUSES)[number];
export type FeatureTaskStatus = (typeof FEATURE_TASK_STATUSES)[number];

export const FEATURE_PLAN_LIMITS = {
  MAX_TASKS: 12,
  MAX_SERIALIZED_CHARACTERS: 16_000,
  MAX_SOURCE_REQUEST: 4_000,
  MAX_TITLE: 120,
  MAX_SUMMARY: 1_000,
  MAX_OBJECTIVE: 1_000,
  MAX_SCOPE: 500,
  MAX_DEPENDENCIES: 4,
  MAX_EXPECTED_AREAS: 8,
  MAX_ACCEPTANCE_CRITERIA: 6,
  MAX_ACCEPTANCE_CRITERION: 240,
  MAX_LAST_OUTCOME_SUMMARY: 500,
  MAX_TASK_ID_LENGTH: 64,
} as const;

export const DECOMPOSITION_CONTEXT_LIMITS = {
  MAX_SERIALIZED_CHARACTERS: 15_000,
} as const;

export interface FeatureTaskOutcomeVerificationStage {
  readonly stage:
    | 'PROJECT_VALIDATION'
    | 'DEPENDENCY_VALIDATION'
    | 'BUILD_VALIDATION'
    | 'TEST_VALIDATION'
    | 'LINT_VALIDATION'
    | 'TYPECHECK_VALIDATION'
    | 'FORMAT_VALIDATION';
  readonly status: 'PASSED' | 'FAILED' | 'SKIPPED';
}

export interface FeatureTaskOutcome {
  readonly summary: string;
  readonly verificationStatus?: 'PASSED' | 'PARTIALLY_PASSED' | 'FAILED';
  readonly verificationStages?: readonly FeatureTaskOutcomeVerificationStage[];
  readonly applyStatus?: string;
  readonly changedPaths?: readonly string[];
  readonly completedAt: string;
  readonly acknowledgedPartialPass?: boolean;
}

export interface FeatureTask {
  readonly taskId: string;
  readonly title: string;
  readonly objective: string;
  readonly scope: string;
  readonly dependencyIds: readonly string[];
  readonly expectedAreas: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly order: number;
  readonly status: FeatureTaskStatus;
  readonly lastOutcome?: FeatureTaskOutcome;
}

export interface FeaturePlan {
  readonly schemaVersion: typeof FEATURE_PLAN_SCHEMA_VERSION;
  readonly featurePlanId: string;
  readonly sourceRequest: string;
  readonly title: string;
  readonly summary: string;
  readonly status: FeaturePlanStatus;
  readonly tasks: readonly FeatureTask[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly activeTaskId?: string;
}

export interface FeatureTaskExecutionBinding {
  readonly featurePlanId: string;
  readonly taskId: string;
  readonly dependencyOverrides?: readonly string[];
}
