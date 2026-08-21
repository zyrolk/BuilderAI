import { describe, expect, it } from 'vitest';

import type { WorkspaceActivity } from '../../../application/workspace/activity-history.types';
import { statusClassName, toActivityHistoryDisplay } from '../activity-history-display';

function activity(
  type: WorkspaceActivity['type'],
  payload: WorkspaceActivity['payload'],
): WorkspaceActivity {
  return {
    activityId: 'act-1',
    type,
    timestamp: '2026-08-20T12:00:00.000Z',
    featurePlanId: 'plan-1',
    taskId: 'task-1',
    correlationId: 'corr-1',
    payload,
  } as WorkspaceActivity;
}

describe('activity history display', () => {
  it('maps preparation lifecycle activities', () => {
    expect(
      toActivityHistoryDisplay(
        activity('TASK_PREPARATION_STARTED', { promptBudgetCharacters: 1200 }),
      ),
    ).toMatchObject({ status: 'running', label: 'Task preparation' });
    expect(toActivityHistoryDisplay(activity('TASK_PREPARATION_STARTED', {})).summaryLines).toEqual(
      [],
    );
    expect(
      toActivityHistoryDisplay(
        activity('TASK_PREPARATION_COMPLETED', {
          durationMs: 10,
          changePlanSummary: {
            createdCount: 1,
            updatedCount: 2,
            deletedCount: 0,
            affectedPaths: ['src/a.ts'],
          },
        }),
      ),
    ).toMatchObject({ status: 'completed', paths: ['src/a.ts'] });
    expect(
      toActivityHistoryDisplay(
        activity('TASK_PREPARATION_FAILED', {
          durationMs: 5,
          errorCode: 'PROVIDER_UNAVAILABLE',
          errorMessage: 'down',
        }),
      ).status,
    ).toBe('failed');
  });

  it('maps file application lifecycle activities', () => {
    expect(
      toActivityHistoryDisplay(activity('FILE_APPLICATION_STARTED', { changePlanId: 'plan-x' }))
        .summaryLines[0],
    ).toContain('Change plan');
    expect(
      toActivityHistoryDisplay(
        activity('FILE_APPLICATION_COMPLETED', {
          durationMs: 12,
          status: 'APPLIED',
          createdFiles: ['a.ts'],
          updatedFiles: [],
          deletedFiles: [],
          skippedFiles: [],
          warningCount: 0,
          errorCount: 0,
        }),
      ).status,
    ).toBe('completed');
    expect(
      toActivityHistoryDisplay(
        activity('FILE_APPLICATION_COMPLETED', {
          durationMs: 12,
          status: 'PARTIALLY_APPLIED',
          createdFiles: [],
          updatedFiles: ['b.ts'],
          deletedFiles: [],
          skippedFiles: ['c.ts'],
          warningCount: 1,
          errorCount: 1,
        }),
      ),
    ).toMatchObject({ status: 'partial', statusText: 'Partially applied' });
    expect(
      toActivityHistoryDisplay(
        activity('FILE_APPLICATION_FAILED', {
          durationMs: 8,
          status: 'REJECTED',
          errorCode: 'INVALID_CHANGE_PLAN',
          errorMessage: 'rejected',
          failedPath: 'src/bad.ts',
        }),
      ),
    ).toMatchObject({ status: 'failed', statusText: 'Rejected', paths: ['src/bad.ts'] });
    expect(
      toActivityHistoryDisplay(
        activity('FILE_APPLICATION_FAILED', {
          durationMs: 8,
          status: 'FAILED',
          errorCode: 'FILESYSTEM_OPERATION_FAILED',
          errorMessage: 'failed',
        }),
      ).statusText,
    ).toBe('Failed');
  });

  it('maps verification lifecycle activities across stage statuses', () => {
    expect(toActivityHistoryDisplay(activity('VERIFICATION_STARTED', {})).status).toBe('running');
    const completed = toActivityHistoryDisplay(
      activity('VERIFICATION_COMPLETED', {
        durationMs: 20,
        status: 'PASSED',
        stages: [
          { name: 'PROJECT', status: 'PASSED', findingCount: 0, durationMs: 1 },
          { name: 'DEPENDENCY', status: 'SKIPPED', findingCount: 0, durationMs: 1 },
          { name: 'BUILD', status: 'PASSED', findingCount: 0, durationMs: 1 },
          { name: 'TEST', status: 'FAILED', findingCount: 2, durationMs: 1 },
          { name: 'LINT', status: 'PASSED', findingCount: 0, durationMs: 1 },
          { name: 'TYPECHECK', status: 'PASSED', findingCount: 0, durationMs: 1 },
          { name: 'FORMAT', status: 'PASSED', findingCount: 0, durationMs: 1 },
        ],
      }),
    );
    expect(completed.status).toBe('passed');
    expect(completed.summaryLines.some((line) => line.includes('Project: Passed'))).toBe(true);
    expect(completed.summaryLines.some((line) => line.includes('Dependency: Skipped'))).toBe(true);
    expect(completed.summaryLines.some((line) => line.includes('Test: Failed'))).toBe(true);
    expect(
      toActivityHistoryDisplay(
        activity('VERIFICATION_COMPLETED', {
          durationMs: 1,
          status: 'PARTIALLY_PASSED',
          stages: [],
        }),
      ).status,
    ).toBe('partial');
    expect(
      toActivityHistoryDisplay(
        activity('VERIFICATION_COMPLETED', {
          durationMs: 1,
          status: 'FAILED',
          stages: [],
        }),
      ).status,
    ).toBe('failed');
    expect(
      toActivityHistoryDisplay(
        activity('VERIFICATION_FAILED', {
          durationMs: 3,
          errorCode: 'VERIFICATION_COMMAND_TIMEOUT',
          errorMessage: 'timed out',
        }),
      ).status,
    ).toBe('failed');
  });

  it('maps status class names', () => {
    const styles = {
      statusRunning: 'run',
      statusCompleted: 'done',
      statusPartial: 'part',
      statusPassed: 'pass',
      statusFailed: 'fail',
    };
    expect(statusClassName('running', styles)).toBe('run');
    expect(statusClassName('completed', styles)).toBe('done');
    expect(statusClassName('partial', styles)).toBe('part');
    expect(statusClassName('passed', styles)).toBe('pass');
    expect(statusClassName('failed', styles)).toBe('fail');
    expect(statusClassName('running', {})).toBe('');
  });
});
