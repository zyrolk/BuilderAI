export type WorkspaceActivityType =
  | 'TASK_PREPARATION_STARTED'
  | 'TASK_PREPARATION_COMPLETED'
  | 'TASK_PREPARATION_FAILED'
  | 'FILE_APPLICATION_STARTED'
  | 'FILE_APPLICATION_COMPLETED'
  | 'FILE_APPLICATION_FAILED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_COMPLETED'
  | 'VERIFICATION_FAILED';

export interface BaseWorkspaceActivity {
  readonly activityId: string;
  readonly correlationId: string;
  readonly featurePlanId: string;
  readonly taskId: string;
  readonly timestamp: string; // ISO 8601
  readonly type: WorkspaceActivityType;
}

export interface TaskPreparationStartedActivity extends BaseWorkspaceActivity {
  readonly type: 'TASK_PREPARATION_STARTED';
  readonly payload: {
    readonly promptBudgetCharacters?: number;
  };
}

export interface TaskPreparationCompletedActivity extends BaseWorkspaceActivity {
  readonly type: 'TASK_PREPARATION_COMPLETED';
  readonly payload: {
    readonly durationMs: number;
    readonly changePlanSummary: {
      readonly createdCount: number;
      readonly updatedCount: number;
      readonly deletedCount: number;
      readonly affectedPaths: readonly string[];
    };
  };
}

export interface TaskPreparationFailedActivity extends BaseWorkspaceActivity {
  readonly type: 'TASK_PREPARATION_FAILED';
  readonly payload: {
    readonly durationMs: number;
    readonly errorCode: string;
    readonly errorMessage: string;
  };
}

export interface FileApplicationStartedActivity extends BaseWorkspaceActivity {
  readonly type: 'FILE_APPLICATION_STARTED';
  readonly payload: {
    readonly changePlanId?: string;
  };
}

export interface FileApplicationCompletedActivity extends BaseWorkspaceActivity {
  readonly type: 'FILE_APPLICATION_COMPLETED';
  readonly payload: {
    readonly durationMs: number;
    readonly status: 'APPLIED' | 'PARTIALLY_APPLIED';
    readonly createdFiles: readonly string[];
    readonly updatedFiles: readonly string[];
    readonly deletedFiles: readonly string[];
    readonly skippedFiles: readonly string[];
    readonly warningCount: number;
    readonly errorCount: number;
  };
}

export interface FileApplicationFailedActivity extends BaseWorkspaceActivity {
  readonly type: 'FILE_APPLICATION_FAILED';
  readonly payload: {
    readonly durationMs: number;
    readonly status: 'REJECTED' | 'FAILED';
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly failedPath?: string;
  };
}

export interface VerificationStartedActivity extends BaseWorkspaceActivity {
  readonly type: 'VERIFICATION_STARTED';
  readonly payload: Record<string, never>;
}

export interface VerificationCompletedActivity extends BaseWorkspaceActivity {
  readonly type: 'VERIFICATION_COMPLETED';
  readonly payload: {
    readonly durationMs: number;
    readonly status: 'PASSED' | 'PARTIALLY_PASSED' | 'FAILED';
    readonly stages: readonly {
      readonly name: 'PROJECT' | 'DEPENDENCY' | 'BUILD' | 'TEST' | 'LINT' | 'TYPECHECK';
      readonly status: 'PASSED' | 'FAILED' | 'SKIPPED';
      readonly durationMs: number;
      readonly findingCount: number;
    }[];
  };
}

export interface VerificationFailedActivity extends BaseWorkspaceActivity {
  readonly type: 'VERIFICATION_FAILED';
  readonly payload: {
    readonly durationMs: number;
    readonly errorCode: string;
    readonly errorMessage: string;
  };
}

export type WorkspaceActivity =
  | TaskPreparationStartedActivity
  | TaskPreparationCompletedActivity
  | TaskPreparationFailedActivity
  | FileApplicationStartedActivity
  | FileApplicationCompletedActivity
  | FileApplicationFailedActivity
  | VerificationStartedActivity
  | VerificationCompletedActivity
  | VerificationFailedActivity;

export interface WorkspaceActivityHistory {
  readonly schemaVersion: 1;
  readonly activities: readonly WorkspaceActivity[];
}

// Explicit aliases to satisfy the exact naming in the acceptance criteria
export type ActivityHistoryEntry = WorkspaceActivity;
export interface ActivityHistory {
  readonly schemaVersion: 1;
  readonly activities: readonly ActivityHistoryEntry[];
}
