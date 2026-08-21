import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { digestCheckpointContent } from '../../../core/file-apply/ports/file-apply-checkpoint.port';
import { WorkflowLedgerError } from '../../../core/workflow-ledger';
import { DurableApplyCheckpointStore } from '../durable-apply-checkpoint.store';

const FIXED_TIME = new Date('2026-08-20T12:00:00.000Z');
const SECRET_CONTENT = 'OPENAI_API_KEY=super-secret-token-do-not-persist';

describe.sequential('DurableApplyCheckpointStore', () => {
  let stateRoot: string;
  const projectId = 'project-a';

  beforeEach(async () => {
    stateRoot = await mkdtemp(path.join(os.tmpdir(), '.builderai-runtime-'));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  function checkpointFile(workflowId: string): string {
    return path.join(stateRoot, 'workflows', projectId, workflowId, 'apply-checkpoint.json');
  }

  it('persists digests only — never raw file contents or secrets', async () => {
    const store = new DurableApplyCheckpointStore(stateRoot, projectId, () => FIXED_TIME);
    await store.bindWorkflow('wf-digest');
    await store.captureBaseline('src/config.ts', 'UPDATE_FILE', SECRET_CONTENT);
    await store.recordMutationResult('src/config.ts', 'UPDATE_FILE', `${SECRET_CONTENT}-mutated`);

    const raw = await readFile(checkpointFile('wf-digest'), 'utf8');
    expect(raw).not.toContain('OPENAI_API_KEY');
    expect(raw).not.toContain('super-secret');
    expect(raw).toContain(digestCheckpointContent(SECRET_CONTENT));
    expect(raw).toContain(digestCheckpointContent(`${SECRET_CONTENT}-mutated`));

    const loaded = await store.load('wf-digest');
    expect(loaded?.operations[0]?.baselineDigest).toBe(digestCheckpointContent(SECRET_CONTENT));
    expect(loaded?.operations[0]?.writtenDigest).toBe(
      digestCheckpointContent(`${SECRET_CONTENT}-mutated`),
    );
    for (const operation of loaded?.operations ?? []) {
      expect(JSON.stringify(operation)).not.toMatch(
        /baselineContent|writtenContent|secret|api[_-]?key/i,
      );
    }
  });

  it('writes atomically under the configured state root', async () => {
    const store = new DurableApplyCheckpointStore(stateRoot, projectId, () => FIXED_TIME);
    await store.bindWorkflow('wf-atomic');
    await store.captureBaseline('README.md', 'CREATE_FILE', null);

    const checkpointDir = path.dirname(checkpointFile('wf-atomic'));
    const entries = await readdir(checkpointDir);
    expect(entries).toContain('apply-checkpoint.json');
    expect(entries.some((name) => name.includes('.tmp'))).toBe(false);
    expect(checkpointFile('wf-atomic').startsWith(path.resolve(stateRoot))).toBe(true);
  });

  it('loads an incomplete IN_PROGRESS checkpoint after restart (new store instance)', async () => {
    const workflowId = 'wf-restart';
    const first = new DurableApplyCheckpointStore(stateRoot, projectId, () => FIXED_TIME);
    await first.bindWorkflow(workflowId);
    await first.captureBaseline('src/a.ts', 'UPDATE_FILE', 'before apply');

    const restarted = new DurableApplyCheckpointStore(stateRoot, projectId);
    const loaded = await restarted.load(workflowId);

    expect(loaded).toBeDefined();
    expect(loaded?.status).toBe('IN_PROGRESS');
    expect(loaded?.recoveryClassification).toBe('RECOVERY_REQUIRED');
    expect(loaded?.operations).toHaveLength(1);
    expect(loaded?.operations[0]?.state).toBe('CAPTURED');
  });

  it('throws CORRUPT_STATE when checkpoint JSON is invalid', async () => {
    const workflowId = 'wf-corrupt';
    const filePath = checkpointFile(workflowId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{not valid json', 'utf8');

    const store = new DurableApplyCheckpointStore(stateRoot, projectId);
    await expect(store.load(workflowId)).rejects.toMatchObject({
      code: 'CORRUPT_STATE',
    });
    await expect(store.load(workflowId)).rejects.toBeInstanceOf(WorkflowLedgerError);
  });

  it('rejects workflowId path traversal via assertSafeStatePath on persist', async () => {
    const store = new DurableApplyCheckpointStore(stateRoot, projectId);
    const workflowDirDepth = path
      .join(stateRoot, 'workflows', projectId)
      .split(path.sep)
      .filter((segment) => segment.length > 0).length;
    const escapeWorkflowId = `${'../'.repeat(workflowDirDepth + 1)}outside-workflow`;

    await expect(store.bindWorkflow(escapeWorkflowId)).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
  });

  it('returns undefined when load target escapes the state root', async () => {
    const store = new DurableApplyCheckpointStore(stateRoot, projectId);
    await expect(store.load('../../outside')).resolves.toBeUndefined();
  });
});
