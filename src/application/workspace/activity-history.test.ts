import {
  parseWorkspaceActivity,
  parseWorkspaceActivityHistory,
  parseActivityHistoryEntry,
  parseActivityHistory,
} from './activity-history.schemas';
import type { WorkspaceActivityHistory, ActivityHistory } from './activity-history.types';

describe('Workspace Activity History Schemas', () => {
  const validActivity = {
    activityId: '11111111-1111-1111-1111-111111111111',
    correlationId: '22222222-2222-2222-2222-222222222222',
    featurePlanId: 'plan-123',
    taskId: 'task-456',
    timestamp: '2026-08-02T09:05:43.016Z',
    type: 'TASK_PREPARATION_COMPLETED' as const,
    payload: {
      durationMs: 1200,
      changePlanSummary: {
        createdCount: 2,
        updatedCount: 1,
        deletedCount: 0,
        affectedPaths: ['src/index.ts', 'package.json'],
      },
    },
  };

  it('should successfully parse a valid activity history', () => {
    const history: WorkspaceActivityHistory = {
      schemaVersion: 1,
      activities: [validActivity],
    };

    const parsed = parseWorkspaceActivityHistory(history);
    expect(parsed).toEqual(history);
  });

  it('should successfully parse using the explicit ActivityHistory and ActivityHistoryEntry schemas', () => {
    const history: ActivityHistory = {
      schemaVersion: 1,
      activities: [validActivity],
    };

    const parsedEntry = parseActivityHistoryEntry(validActivity);
    expect(parsedEntry).toEqual(validActivity);

    const parsedHistory = parseActivityHistory(history);
    expect(parsedHistory).toEqual(history);
  });

  it('should reject absolute paths in affectedPaths', () => {
    const invalidActivity = {
      ...validActivity,
      payload: {
        ...validActivity.payload,
        changePlanSummary: {
          ...validActivity.payload.changePlanSummary,
          affectedPaths: ['/absolute/path/to/file.ts'],
        },
      },
    };

    expect(() => parseWorkspaceActivity(invalidActivity)).toThrow();
    expect(() => parseActivityHistoryEntry(invalidActivity)).toThrow();
  });

  it('should reject forbidden fields like stdout or stderr', () => {
    const invalidActivity = {
      ...validActivity,
      payload: {
        ...validActivity.payload,
        stdout: 'some raw output',
      },
    };

    expect(() => parseWorkspaceActivity(invalidActivity)).toThrow();
    expect(() => parseActivityHistoryEntry(invalidActivity)).toThrow();
  });

  it('should reject forbidden fields like secret or apikey', () => {
    const invalidActivity = {
      ...validActivity,
      payload: {
        ...validActivity.payload,
        apiKey: 'super-secret-token',
      },
    };

    expect(() => parseWorkspaceActivity(invalidActivity)).toThrow();
    expect(() => parseActivityHistoryEntry(invalidActivity)).toThrow();
  });
});
