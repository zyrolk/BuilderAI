import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ActivityHistoryService } from './activity-history.service';
import type {
  FileApplicationCompletedActivity,
  TaskPreparationStartedActivity,
} from './activity-history.types';

type SanitizationOverflowPayload = TaskPreparationStartedActivity['payload'] &
  Record<string, unknown>;

interface NodeJSException extends Error {
  code?: string;
}

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

describe('ActivityHistoryService', () => {
  const mockFiles = new Map<string, string>();
  const projectRoot = path.resolve('/mock/project/root');

  beforeEach(() => {
    mockFiles.clear();
    vi.clearAllMocks();

    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const normalizedPath = path.resolve(filePath.toString());
      const content = mockFiles.get(normalizedPath);
      if (content === undefined) {
        const error = new Error(
          `ENOENT: no such file or directory, open '${filePath}'`,
        ) as NodeJSException;
        error.code = 'ENOENT';
        throw error;
      }
      return content;
    });

    vi.mocked(fs.writeFile).mockImplementation(async (filePath, data) => {
      const normalizedPath = path.resolve(filePath.toString());
      mockFiles.set(normalizedPath, data.toString());
    });

    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
  });

  function createDummyActivity(
    overrides?: Partial<TaskPreparationStartedActivity>,
  ): TaskPreparationStartedActivity {
    return {
      activityId: 'act-123',
      correlationId: 'corr-123',
      featurePlanId: 'plan-123',
      taskId: 'task-123',
      timestamp: '2026-08-03T07:27:03.958Z',
      type: 'TASK_PREPARATION_STARTED',
      payload: {
        promptBudgetCharacters: 1000,
      },
      ...overrides,
    };
  }

  function createStartedActivityWithOverflowPayload(
    payload: SanitizationOverflowPayload,
  ): TaskPreparationStartedActivity {
    return createDummyActivity({ payload });
  }

  function createFileApplicationCompletedActivity(
    overrides?: Partial<FileApplicationCompletedActivity>,
  ): FileApplicationCompletedActivity {
    return {
      activityId: 'act-123',
      correlationId: 'corr-123',
      featurePlanId: 'plan-123',
      taskId: 'task-123',
      timestamp: '2026-08-03T07:27:03.958Z',
      type: 'FILE_APPLICATION_COMPLETED',
      payload: {
        durationMs: 1,
        status: 'APPLIED',
        createdFiles: [],
        updatedFiles: [],
        deletedFiles: [],
        skippedFiles: [],
        warningCount: 0,
        errorCount: 0,
      },
      ...overrides,
    };
  }

  it('should successfully write history entries to .builderai/activity-history.json', async () => {
    const service = new ActivityHistoryService({ projectRoot });
    const activity = createDummyActivity({ activityId: 'act-1' });

    const result = await service.recordActivity(activity);
    expect(result.activities).toHaveLength(1);

    const firstActivity = result.activities[0];
    expect(firstActivity).toBeDefined();
    if (firstActivity) {
      expect(firstActivity.activityId).toBe('act-1');
    }

    const historyFile = service.getHistoryFilePath();
    expect(mockFiles.has(path.resolve(historyFile))).toBe(true);

    const readResult = await service.readHistory();
    expect(readResult.activities).toHaveLength(1);
    const readFirst = readResult.activities[0];
    expect(readFirst).toBeDefined();
    if (readFirst) {
      expect(readFirst.activityId).toBe('act-1');
    }
  });

  it('should bound history to a configurable maximum limit, evicting oldest entries first', async () => {
    const service = new ActivityHistoryService({ projectRoot, maxEntries: 3 });

    await service.recordActivity(createDummyActivity({ activityId: 'act-1' }));
    await service.recordActivity(createDummyActivity({ activityId: 'act-2' }));
    await service.recordActivity(createDummyActivity({ activityId: 'act-3' }));
    const finalResult = await service.recordActivity(createDummyActivity({ activityId: 'act-4' }));

    expect(finalResult.activities).toHaveLength(3);

    const first = finalResult.activities[0];
    const second = finalResult.activities[1];
    const third = finalResult.activities[2];

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();

    if (first && second && third) {
      expect(first.activityId).toBe('act-2');
      expect(second.activityId).toBe('act-3');
      expect(third.activityId).toBe('act-4');
    }
  });

  it('should sanitize absolute paths to relative POSIX paths in the payload', async () => {
    const service = new ActivityHistoryService({ projectRoot });
    const absolutePathPosix = '/mock/project/root/src/components/Button.tsx';
    const absolutePathWindows = 'C:\\mock\\project\\root\\src\\components\\Button.tsx';

    const fileApplicationActivity = createFileApplicationCompletedActivity({
      payload: {
        durationMs: 1,
        status: 'APPLIED',
        createdFiles: [absolutePathPosix],
        updatedFiles: [absolutePathWindows],
        deletedFiles: ['/mock/project/root/package.json'],
        skippedFiles: [],
        warningCount: 0,
        errorCount: 0,
      },
    });

    const nestedPathActivity = createStartedActivityWithOverflowPayload({
      promptBudgetCharacters: 1000,
      nested: {
        anotherPath: '/mock/project/root/package.json',
      },
    });

    const fileApplicationResult = await service.recordActivity(fileApplicationActivity);
    const nestedPathResult = await service.recordActivity(nestedPathActivity);

    const fileApplicationRecorded = fileApplicationResult.activities[0];
    expect(fileApplicationRecorded).toBeDefined();
    if (fileApplicationRecorded && fileApplicationRecorded.type === 'FILE_APPLICATION_COMPLETED') {
      expect(fileApplicationRecorded.payload.createdFiles[0]).toBe('src/components/Button.tsx');
      expect(fileApplicationRecorded.payload.updatedFiles[0]).toBe('src/components/Button.tsx');
      expect(fileApplicationRecorded.payload.deletedFiles[0]).toBe('package.json');
    }

    const nestedPathRecorded = nestedPathResult.activities[1];
    expect(nestedPathRecorded).toBeDefined();
    if (nestedPathRecorded && nestedPathRecorded.type === 'TASK_PREPARATION_STARTED') {
      const payload = nestedPathRecorded.payload as SanitizationOverflowPayload;
      const nested = payload.nested as Record<string, unknown>;
      expect(nested.anotherPath).toBe('package.json');
    }
  });

  it('should exclude secret-like and forbidden payload keys', async () => {
    const service = new ActivityHistoryService({ projectRoot });
    const activity = createStartedActivityWithOverflowPayload({
      promptBudgetCharacters: 1000,
      secret: 'super-secret-key',
      token: 'api-token',
      password: 'my-password',
      stdout: 'some stdout logs',
      stderr: 'some stderr logs',
      safeKey: 'safe-value',
      secretToken: 'composite-secret-token',
    });

    const result = await service.recordActivity(activity);
    const recorded = result.activities[0];
    expect(recorded).toBeDefined();

    if (recorded && recorded.type === 'TASK_PREPARATION_STARTED') {
      const payload = recorded.payload as SanitizationOverflowPayload;
      expect(payload.safeKey).toBe('safe-value');
      expect(payload.promptBudgetCharacters).toBe(1000);
      expect(payload.secret).toBeUndefined();
      expect(payload.token).toBeUndefined();
      expect(payload.password).toBeUndefined();
      expect(payload.stdout).toBeUndefined();
      expect(payload.stderr).toBeUndefined();
      expect(payload.secretToken).toBeUndefined();
    }
  });
});
