export const UPDATE_SCOPE_PLAN_SCHEMA_VERSION = 1 as const;

export const MAXIMUM_REQUIRED_BASELINE_PATHS = 3 as const;
export const MAXIMUM_PINNED_BASELINE_CHARACTERS = 48_000 as const;

export type UpdateScopeMode = 'NONE' | 'SOFT' | 'HARD';

export type UpdateScopeEvidenceCode =
  | 'EXPLICIT_PATH_MENTION'
  | 'EXPLICIT_ONLY_PATH_INSTRUCTION'
  | 'TASK_FILE_EXTENSION_HINT'
  | 'ITERATION_PATH_HINT'
  | 'CONTEXT_RANK_TOP'
  | 'HTML_ENTRYPOINT_HEURISTIC'
  | 'BASELINE_UNAVAILABLE'
  | 'BASELINE_BUDGET_EXCEEDED';

export interface UpdateScopeEvidence {
  readonly code: UpdateScopeEvidenceCode;
  readonly path?: string;
  readonly message: string;
}

export interface UpdateScopePlan {
  readonly schemaVersion: typeof UPDATE_SCOPE_PLAN_SCHEMA_VERSION;
  readonly mode: UpdateScopeMode;
  readonly requiredBaselinePaths: readonly string[];
  readonly preferredUpdatePaths: readonly string[];
  readonly preferredMaximumUpdateOperations?: number;
  readonly evidence: readonly UpdateScopeEvidence[];
}

export const INACTIVE_UPDATE_SCOPE_PLAN: UpdateScopePlan = {
  schemaVersion: UPDATE_SCOPE_PLAN_SCHEMA_VERSION,
  mode: 'NONE',
  requiredBaselinePaths: [],
  preferredUpdatePaths: [],
  evidence: [],
};
