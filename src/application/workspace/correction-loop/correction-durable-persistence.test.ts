import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHANGE_PLAN } from '../../../ui/workspace/test/workspace.fixture';
import { createAppliedResult } from '../../../core/verification/test/verification.fixture';
import { CorrectionSessionPersistence } from '../workflow-ledger/correction-session.persistence';
import {
  CorrectionLoopService,
  CorrectionPersistenceError,
  type CorrectionLoopPersistencePort,
} from './correction-loop.service';
import { CORRECTION_LOOP_SCHEMA_VERSION } from './correction-loop.types';
import type { WorkspaceCompletion } from '../workspace-runtime.types';

function failedCompletion(): WorkspaceCompletion {
  return {
    applyResult: {
      ...createAppliedResult(),
      updatedFiles: ['src/example.ts'],
    },
    verificationReport: {
      schemaVersion: 1,
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'FAILED',
          durationMs: 1,
          warnings: [],
          errors: [{ code: 'BUILD_FAILED', message: 'build failed' }],
          metadata: {},
        },
      ],
      warnings: [],
      errors: [{ code: 'BUILD_FAILED', message: 'build failed' }],
      metadata: {},
      startedAt: '2026-08-20T10:00:00.000Z',
      completedAt: '2026-08-20T10:00:01.000Z',
      durationMs: 1,
    },
  } as unknown as WorkspaceCompletion;
}

describe('H1 durable correction session persistence', () => {
  let tempRoot: string;
  let persistence: CorrectionSessionPersistence;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'h1-corr-'));
    persistence = new CorrectionSessionPersistence(tempRoot, 'project-a');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('persists every durable transition and hydrates without auto-continue', async () => {
    const service = new CorrectionLoopService(
      {
        maximumCorrectionAttempts: 2,
        hardMaximumCorrectionAttempts: 3,
        workflowDeadlineMs: 60_000,
      },
      () => new Date('2026-08-20T10:00:00.000Z'),
      persistence,
    );
    await service.hydratePersistedSessions();

    const began = await service.beginFromCompletion('wf-1', failedCompletion(), {
      originalTaskSummary: 'fix build',
    });
    expect(began.session.state).toBe('CORRECTION_PREPARING');
    expect(began.canPrepare).toBe(true);

    const diskPreparing = await persistence.load('wf-1');
    expect(diskPreparing?.state).toBe('CORRECTION_PREPARING');

    const waiting = await service.recordPrepared('wf-1', 'prep-1', CHANGE_PLAN);
    expect(waiting.state).toBe('CORRECTION_WAITING_FOR_APPROVAL');
    expect((await persistence.load('wf-1'))?.state).toBe('CORRECTION_WAITING_FOR_APPROVAL');

    const applying = await service.recordApplying('wf-1');
    expect(applying.state).toBe('CORRECTION_APPLYING');
    expect((await persistence.load('wf-1'))?.state).toBe('CORRECTION_APPLYING');

    const restarted = new CorrectionLoopService(
      {
        maximumCorrectionAttempts: 2,
        hardMaximumCorrectionAttempts: 3,
        workflowDeadlineMs: 60_000,
      },
      () => new Date('2026-08-20T10:00:30.000Z'),
      persistence,
    );
    await restarted.hydratePersistedSessions();
    const hydrated = await restarted.getSessionAsync('wf-1');
    expect(hydrated?.state).toBe('CORRECTION_APPLYING');
    expect(hydrated?.preparationId).toBe('prep-1');
    expect(hydrated?.state).not.toBe('CORRECTION_PASSED');
  });

  it('persists cancelled and blocked terminal states', async () => {
    const service = new CorrectionLoopService(undefined, () => new Date(), persistence);
    await service.hydratePersistedSessions();
    await service.beginFromCompletion('wf-cancel', failedCompletion());
    await service.cancelCorrection('wf-cancel', 'operator stop');
    expect((await persistence.load('wf-cancel'))?.state).toBe('CORRECTION_CANCELLED');
  });

  it('surfaces persistence failures instead of fire-and-forget success', async () => {
    const failing: CorrectionLoopPersistencePort = {
      save: vi.fn(async () => {
        throw new Error('disk full');
      }),
      load: async () => undefined,
      list: async () => [],
    };
    const service = new CorrectionLoopService(undefined, () => new Date(), failing);
    await service.hydratePersistedSessions();
    await expect(service.beginFromCompletion('wf-fail', failedCompletion())).rejects.toBeInstanceOf(
      CorrectionPersistenceError,
    );
  });

  it('skips corrupted correction-session files on load/list', async () => {
    const dir = path.join(tempRoot, 'workflows', 'project-a', 'wf-corrupt');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'correction-session.json'), '{not-json', 'utf8');
    expect(await persistence.load('wf-corrupt')).toBeUndefined();
    expect(await persistence.list()).toEqual([]);

    const service = new CorrectionLoopService(undefined, () => new Date(), persistence);
    await service.hydratePersistedSessions();
    expect(await service.getSessionAsync('wf-corrupt')).toBeUndefined();
  });

  it('awaits hydration before treating service as ready', async () => {
    let resolveList!: (value: readonly never[]) => void;
    const slowList = new Promise<readonly never[]>((resolve) => {
      resolveList = resolve;
    });
    const slowPersistence: CorrectionLoopPersistencePort = {
      save: async () => undefined,
      load: async () => undefined,
      list: async () => slowList,
    };
    const service = new CorrectionLoopService(undefined, () => new Date(), slowPersistence);
    const hydrate = service.hydratePersistedSessions();
    let ready = false;
    void service.whenReady().then(() => {
      ready = true;
    });
    expect(ready).toBe(false);
    resolveList([]);
    await hydrate;
    await service.whenReady();
    expect(ready).toBe(true);
  });

  it('writes schema-versioned session JSON atomically', async () => {
    const service = new CorrectionLoopService(undefined, () => new Date(), persistence);
    await service.hydratePersistedSessions();
    await service.beginFromCompletion('wf-atom', failedCompletion());
    const raw = await readFile(
      path.join(tempRoot, 'workflows', 'project-a', 'wf-atom', 'correction-session.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { schemaVersion: number; state: string };
    expect(parsed.schemaVersion).toBe(CORRECTION_LOOP_SCHEMA_VERSION);
    expect(parsed.state).toBe('CORRECTION_PREPARING');
  });
});
