import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeFeaturePlan } from './feature-plan.service';
import { FeaturePlanPersistence } from './feature-plan.persistence';
import { WorkspaceRuntimeError } from './workspace-runtime.types';

const NOW = '2026-08-01T00:00:00.000Z';

function samplePlan(featurePlanId: string) {
  return normalizeFeaturePlan(
    {
      schemaVersion: 1,
      featurePlanId,
      sourceRequest: 'Build checkout',
      title: 'Checkout',
      summary: 'Checkout summary',
      status: 'APPROVED',
      createdAt: NOW,
      updatedAt: NOW,
      tasks: [
        {
          taskId: 'task-01',
          title: 'Schema',
          objective: 'Add schema',
          scope: 'prisma',
          dependencyIds: [],
          expectedAreas: ['prisma'],
          acceptanceCriteria: ['Schema validates'],
          order: 1,
          status: 'READY',
        },
      ],
    },
    { now: NOW },
  );
}

describe('FeaturePlanPersistence', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  async function createRoot(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-feature-plan-'));
    roots.push(root);
    return root;
  }

  it('persists and reloads an approved plan', async () => {
    const root = await createRoot();
    const persistence = new FeaturePlanPersistence(root);
    const saved = await persistence.save(samplePlan('persist-plan-01'));
    const reloaded = await persistence.load(saved.featurePlanId);
    expect(reloaded.featurePlanId).toBe('persist-plan-01');
    expect(reloaded.status).toBe('APPROVED');
  });

  it('recovers the active plan after simulated restart', async () => {
    const root = await createRoot();
    const first = new FeaturePlanPersistence(root);
    await first.save(samplePlan('persist-plan-02'));
    const second = new FeaturePlanPersistence(root);
    const active = await second.loadActive();
    expect(active?.featurePlanId).toBe('persist-plan-02');
  });

  it('rejects corrupt persisted JSON safely', async () => {
    const root = await createRoot();
    const persistence = new FeaturePlanPersistence(root);
    const directory = path.join(root, '.builderai', 'feature-plans');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'corrupt-plan-01.json'), '{not-json', 'utf8');
    await expect(persistence.load('corrupt-plan-01')).rejects.toThrow(WorkspaceRuntimeError);
  });

  it('rejects traversal plan identifiers', async () => {
    const root = await createRoot();
    const persistence = new FeaturePlanPersistence(root);
    await expect(persistence.load('../escape-plan')).rejects.toThrow(WorkspaceRuntimeError);
  });

  it.skipIf(process.platform === 'win32')('rejects symlink escape attempts', async () => {
    const root = await createRoot();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'builderai-outside-'));
    roots.push(outside);
    const linkPath = path.join(root, '.builderai', 'feature-plans');
    await mkdir(path.dirname(linkPath), { recursive: true });
    await symlink(outside, linkPath, 'dir');
    const persistence = new FeaturePlanPersistence(root);
    await expect(persistence.save(samplePlan('symlink-plan-01'))).rejects.toThrow(
      WorkspaceRuntimeError,
    );
  });

  it('uses atomic replace writes', async () => {
    const root = await createRoot();
    const persistence = new FeaturePlanPersistence(root);
    const plan = samplePlan('atomic-plan-01');
    await persistence.save(plan);
    const filePath = path.join(root, '.builderai', 'feature-plans', 'atomic-plan-01.json');
    const contents = await readFile(filePath, 'utf8');
    expect(contents.endsWith('\n')).toBe(true);
    expect(contents).toContain('"featurePlanId": "atomic-plan-01"');
  });
});
