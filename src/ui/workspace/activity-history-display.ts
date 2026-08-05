import type {
  WorkspaceActivity,
  WorkspaceActivityType,
} from '../../application/workspace/activity-history.types';

export type ActivityHistoryDisplayStatus =
  'running' | 'completed' | 'partial' | 'passed' | 'failed';

export interface ActivityHistoryDisplayModel {
  readonly activityId: string;
  readonly type: WorkspaceActivityType;
  readonly label: string;
  readonly status: ActivityHistoryDisplayStatus;
  readonly statusText: string;
  readonly timestamp: string;
  readonly paths: readonly string[];
  readonly summaryLines: readonly string[];
}

export function toActivityHistoryDisplay(activity: WorkspaceActivity): ActivityHistoryDisplayModel {
  switch (activity.type) {
    case 'TASK_PREPARATION_STARTED':
      return base(
        activity,
        'Task preparation',
        'running',
        'In progress',
        [],
        [
          ...(activity.payload.promptBudgetCharacters === undefined
            ? []
            : [
                `Prompt budget: ${activity.payload.promptBudgetCharacters.toLocaleString()} characters`,
              ]),
        ],
      );
    case 'TASK_PREPARATION_COMPLETED':
      return base(
        activity,
        'Task preparation',
        'completed',
        'Completed',
        activity.payload.changePlanSummary.affectedPaths,
        [
          `Duration: ${activity.payload.durationMs.toLocaleString()} ms`,
          `Created ${activity.payload.changePlanSummary.createdCount}, updated ${activity.payload.changePlanSummary.updatedCount}, deleted ${activity.payload.changePlanSummary.deletedCount}`,
        ],
      );
    case 'TASK_PREPARATION_FAILED':
      return base(
        activity,
        'Task preparation',
        'failed',
        'Failed',
        [],
        [
          `Duration: ${activity.payload.durationMs.toLocaleString()} ms`,
          `Error: ${activity.payload.errorCode}`,
        ],
      );
    case 'FILE_APPLICATION_STARTED':
      return base(
        activity,
        'File application',
        'running',
        'In progress',
        [],
        [
          ...(activity.payload.changePlanId === undefined
            ? []
            : [`Change plan: ${activity.payload.changePlanId}`]),
        ],
      );
    case 'FILE_APPLICATION_COMPLETED':
      return base(
        activity,
        'File application',
        activity.payload.status === 'PARTIALLY_APPLIED' ? 'partial' : 'completed',
        activity.payload.status === 'PARTIALLY_APPLIED' ? 'Partially applied' : 'Applied',
        [
          ...activity.payload.createdFiles,
          ...activity.payload.updatedFiles,
          ...activity.payload.deletedFiles,
        ],
        [
          `Duration: ${activity.payload.durationMs.toLocaleString()} ms`,
          `Warnings: ${activity.payload.warningCount}, errors: ${activity.payload.errorCount}`,
          ...(activity.payload.skippedFiles.length === 0
            ? []
            : [`Skipped files: ${activity.payload.skippedFiles.length}`]),
        ],
      );
    case 'FILE_APPLICATION_FAILED':
      return base(
        activity,
        'File application',
        'failed',
        activity.payload.status === 'REJECTED' ? 'Rejected' : 'Failed',
        activity.payload.failedPath === undefined ? [] : [activity.payload.failedPath],
        [
          `Duration: ${activity.payload.durationMs.toLocaleString()} ms`,
          `Error: ${activity.payload.errorCode}`,
        ],
      );
    case 'VERIFICATION_STARTED':
      return base(activity, 'Verification', 'running', 'In progress', [], []);
    case 'VERIFICATION_COMPLETED':
      return base(
        activity,
        'Verification',
        verificationCompletedStatus(activity.payload.status),
        formatVerificationStatus(activity.payload.status),
        [],
        [
          `Duration: ${activity.payload.durationMs.toLocaleString()} ms`,
          ...activity.payload.stages.map(
            (stage) =>
              `${formatStageName(stage.name)}: ${formatStageStatus(stage.status)} (${stage.findingCount} findings)`,
          ),
        ],
      );
    case 'VERIFICATION_FAILED':
      return base(
        activity,
        'Verification',
        'failed',
        'Failed',
        [],
        [
          `Duration: ${activity.payload.durationMs.toLocaleString()} ms`,
          `Error: ${activity.payload.errorCode}`,
        ],
      );
  }
}

function base(
  activity: WorkspaceActivity,
  label: string,
  status: ActivityHistoryDisplayStatus,
  statusText: string,
  paths: readonly string[],
  summaryLines: readonly string[],
): ActivityHistoryDisplayModel {
  return {
    activityId: activity.activityId,
    type: activity.type,
    label,
    status,
    statusText,
    timestamp: activity.timestamp,
    paths: [...paths].sort((left, right) => left.localeCompare(right)),
    summaryLines,
  };
}

function verificationCompletedStatus(
  status: 'PASSED' | 'PARTIALLY_PASSED' | 'FAILED',
): ActivityHistoryDisplayStatus {
  if (status === 'PASSED') return 'passed';
  if (status === 'PARTIALLY_PASSED') return 'partial';
  return 'failed';
}

function formatVerificationStatus(status: 'PASSED' | 'PARTIALLY_PASSED' | 'FAILED'): string {
  if (status === 'PASSED') return 'Passed';
  if (status === 'PARTIALLY_PASSED') return 'Partially passed';
  return 'Failed';
}

function formatStageName(
  name: 'PROJECT' | 'DEPENDENCY' | 'BUILD' | 'TEST' | 'LINT' | 'TYPECHECK',
): string {
  switch (name) {
    case 'PROJECT':
      return 'Project';
    case 'DEPENDENCY':
      return 'Dependency';
    case 'BUILD':
      return 'Build';
    case 'TEST':
      return 'Test';
    case 'LINT':
      return 'Lint';
    case 'TYPECHECK':
      return 'Typecheck';
  }
}

function formatStageStatus(status: 'PASSED' | 'FAILED' | 'SKIPPED'): string {
  if (status === 'PASSED') return 'Passed';
  if (status === 'SKIPPED') return 'Skipped';
  return 'Failed';
}

export function statusClassName(
  status: ActivityHistoryDisplayStatus,
  styles: {
    readonly statusRunning?: string;
    readonly statusCompleted?: string;
    readonly statusPartial?: string;
    readonly statusPassed?: string;
    readonly statusFailed?: string;
  },
): string {
  switch (status) {
    case 'running':
      return styles.statusRunning ?? '';
    case 'completed':
      return styles.statusCompleted ?? '';
    case 'partial':
      return styles.statusPartial ?? '';
    case 'passed':
      return styles.statusPassed ?? '';
    case 'failed':
      return styles.statusFailed ?? '';
  }
}
