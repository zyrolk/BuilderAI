import type { ProjectChangePlan } from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type {
  VerificationReport,
  VerificationStage,
  VerificationStageResult,
} from '../../core/verification';
import type {
  FileApplicationCompletedActivity,
  FileApplicationFailedActivity,
  TaskPreparationCompletedActivity,
  VerificationCompletedActivity,
  WorkspaceActivity,
} from './activity-history.types';
import type { FeatureTaskPreparationBinding } from './workspace-runtime.types';

export interface ActivityHistoryIdentity extends FeatureTaskPreparationBinding {
  readonly correlationId: string;
  readonly activityId: string;
  readonly timestamp: string;
}

export function summarizeChangePlan(
  changePlan: ProjectChangePlan,
): TaskPreparationCompletedActivity['payload']['changePlanSummary'] {
  const created = changePlan.changeSet.operations
    .filter((operation) => operation.kind === 'CREATE_FILE')
    .map((operation) => operation.logicalPath);
  const updated = changePlan.changeSet.operations
    .filter((operation) => operation.kind === 'UPDATE_FILE')
    .map((operation) => operation.logicalPath);
  const deleted = changePlan.changeSet.operations
    .filter((operation) => operation.kind === 'DELETE_FILE')
    .map((operation) => operation.logicalPath);
  return {
    createdCount: created.length,
    updatedCount: updated.length,
    deletedCount: deleted.length,
    affectedPaths: [...created, ...updated, ...deleted].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

export function createFileApplicationCompletedActivity(
  identity: ActivityHistoryIdentity,
  applyResult: FileApplyResult,
): FileApplicationCompletedActivity {
  return {
    ...identity,
    type: 'FILE_APPLICATION_COMPLETED',
    payload: {
      durationMs: applyResult.durationMs,
      status: applyResult.status === 'PARTIALLY_APPLIED' ? 'PARTIALLY_APPLIED' : 'APPLIED',
      createdFiles: [...applyResult.createdFiles],
      updatedFiles: [...applyResult.updatedFiles],
      deletedFiles: [...applyResult.deletedFiles],
      skippedFiles: [...applyResult.skippedFiles],
      warningCount: applyResult.warnings.length,
      errorCount: applyResult.errors.length,
    },
  };
}

export function createFileApplicationFailedActivity(
  identity: ActivityHistoryIdentity,
  applyResult: FileApplyResult,
): FileApplicationFailedActivity {
  const primaryError = applyResult.errors[0];
  return {
    ...identity,
    type: 'FILE_APPLICATION_FAILED',
    payload: {
      durationMs: applyResult.durationMs,
      status: applyResult.status === 'REJECTED' ? 'REJECTED' : 'FAILED',
      errorCode: primaryError?.code ?? applyResult.status,
      errorMessage: primaryError?.message ?? `Apply ended with status ${applyResult.status}.`,
      ...(primaryError?.logicalPath === undefined ? {} : { failedPath: primaryError.logicalPath }),
    },
  };
}

export function createVerificationCompletedActivity(
  identity: ActivityHistoryIdentity,
  report: VerificationReport,
): VerificationCompletedActivity {
  return {
    ...identity,
    type: 'VERIFICATION_COMPLETED',
    payload: {
      durationMs: report.durationMs,
      status: report.status,
      stages: report.stages.map(mapVerificationStage),
    },
  };
}

function mapVerificationStage(
  stage: VerificationStageResult,
): VerificationCompletedActivity['payload']['stages'][number] {
  return {
    name: mapVerificationStageName(stage.stage),
    status: stage.status,
    durationMs: stage.durationMs,
    findingCount: stage.errors.length + stage.warnings.length,
  };
}

function mapVerificationStageName(
  stage: VerificationStage,
): VerificationCompletedActivity['payload']['stages'][number]['name'] {
  switch (stage) {
    case 'PROJECT_VALIDATION':
      return 'PROJECT';
    case 'DEPENDENCY_VALIDATION':
      return 'DEPENDENCY';
    case 'BUILD_VALIDATION':
      return 'BUILD';
    case 'TEST_VALIDATION':
      return 'TEST';
  }
}

export function isFeatureBoundActivity(
  activity: WorkspaceActivity,
): activity is WorkspaceActivity & FeatureTaskPreparationBinding {
  return activity.featurePlanId.length > 0 && activity.taskId.length > 0;
}
