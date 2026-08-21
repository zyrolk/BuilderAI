import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CORRECTION_LOOP_SCHEMA_VERSION } from '../../correction-loop/correction-loop.types';
import { CorrectionSessionPersistence } from '../correction-session.persistence';

describe('CorrectionSessionPersistence', () => {
  let tempRoot: string;
  let persistence: CorrectionSessionPersistence;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'corr-persist-'));
    persistence = new CorrectionSessionPersistence(tempRoot, 'project-a');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('lists persisted sessions from workflow directories', async () => {
    await persistence.save({
      schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
      workflowId: 'wf-a',
      state: 'CORRECTION_WAITING_FOR_APPROVAL',
      attempt: 1,
      maximumAttempts: 3,
      startedAt: '2026-08-20T10:00:00.000Z',
      deadlineAt: '2026-08-20T13:00:00.000Z',
      attemptHistory: [],
    });
    await persistence.save({
      schemaVersion: CORRECTION_LOOP_SCHEMA_VERSION,
      workflowId: 'wf-b',
      state: 'CORRECTION_PASSED',
      attempt: 2,
      maximumAttempts: 3,
      startedAt: '2026-08-20T10:00:00.000Z',
      deadlineAt: '2026-08-20T13:00:00.000Z',
      attemptHistory: [],
    });
    const sessions = await persistence.list();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.workflowId).sort()).toEqual(['wf-a', 'wf-b']);
  });

  it('returns empty list when project directory is missing', async () => {
    const missing = new CorrectionSessionPersistence(tempRoot, 'missing-project');
    expect(await missing.list()).toEqual([]);
  });

  it('skips invalid schema versions during list', async () => {
    const dir = path.join(tempRoot, 'workflows', 'project-a', 'wf-invalid');
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'correction-session.json'),
      JSON.stringify({ schemaVersion: 999, workflowId: 'wf-invalid' }),
      'utf8',
    );
    expect(await persistence.list()).toEqual([]);
  });

  it('rejects corrupt session files on load', async () => {
    const dir = path.join(tempRoot, 'workflows', 'project-a', 'wf-corrupt');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'correction-session.json'), '{bad json', 'utf8');
    expect(await persistence.load('wf-corrupt')).toBeUndefined();
  });
});
