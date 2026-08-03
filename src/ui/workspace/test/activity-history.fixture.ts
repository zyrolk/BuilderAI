import type { WorkspaceActivity } from '../../../application/workspace/activity-history.types';

const BASE = {
  featurePlanId: '16a0c3ac-232b-41a2-98fe-4ad6fafd27f5',
  taskId: 'task-3-workspace-orchestration-integration',
  correlationId: 'corr-task-4-ui-fixture',
} as const;

export const PREPARATION_COMPLETED: WorkspaceActivity = {
  activityId: 'act-preparation-completed',
  ...BASE,
  timestamp: '2026-08-03T12:00:00.000Z',
  type: 'TASK_PREPARATION_COMPLETED',
  payload: {
    durationMs: 1200,
    changePlanSummary: {
      createdCount: 1,
      updatedCount: 1,
      deletedCount: 0,
      affectedPaths: [
        'src/application/workspace/workspace-runtime.service.ts',
        'src/ui/workspace/activity-history-panel.tsx',
      ],
    },
  },
};

export const APPLY_COMPLETED: WorkspaceActivity = {
  activityId: 'act-apply-completed',
  ...BASE,
  timestamp: '2026-08-03T12:05:00.000Z',
  type: 'FILE_APPLICATION_COMPLETED',
  payload: {
    durationMs: 850,
    status: 'APPLIED',
    createdFiles: ['src/ui/workspace/activity-history-panel.tsx'],
    updatedFiles: ['src/ui/workspace/workspace.module.css'],
    deletedFiles: [],
    skippedFiles: [],
    warningCount: 0,
    errorCount: 0,
  },
};

export const APPLY_FAILED: WorkspaceActivity = {
  activityId: 'act-apply-failed',
  ...BASE,
  timestamp: '2026-08-03T12:10:00.000Z',
  type: 'FILE_APPLICATION_FAILED',
  payload: {
    durationMs: 420,
    status: 'REJECTED',
    errorCode: 'TARGET_ALREADY_EXISTS',
    errorMessage: 'Target already exists at src/ui/workspace/activity-history-panel.tsx',
    failedPath: 'src/ui/workspace/activity-history-panel.tsx',
  },
};

export const VERIFICATION_COMPLETED: WorkspaceActivity = {
  activityId: 'act-verification-completed',
  ...BASE,
  timestamp: '2026-08-03T12:15:00.000Z',
  type: 'VERIFICATION_COMPLETED',
  payload: {
    durationMs: 5400,
    status: 'PASSED',
    stages: [
      { name: 'PROJECT', status: 'PASSED', durationMs: 900, findingCount: 0 },
      { name: 'DEPENDENCY', status: 'PASSED', durationMs: 1100, findingCount: 0 },
      { name: 'BUILD', status: 'PASSED', durationMs: 1700, findingCount: 0 },
      { name: 'TEST', status: 'PASSED', durationMs: 1700, findingCount: 0 },
    ],
  },
};

export const UNSAFE_FIXTURE_MARKERS = {
  stdout: 'fixture-stdout-marker',
  stderr: 'fixture-stderr-marker',
  rawProviderResponse: 'fixture-raw-provider-response-marker',
  promptText: 'fixture-prompt-text-marker',
  secret: 'fixture-secret-marker',
  token: 'fixture-token-marker',
  absolutePath: 'D:\\projects2\\buiderAI\\src\\secret.ts',
} as const;

export const REPRESENTATIVE_ACTIVITIES: readonly WorkspaceActivity[] = [
  VERIFICATION_COMPLETED,
  APPLY_FAILED,
  APPLY_COMPLETED,
  PREPARATION_COMPLETED,
];
