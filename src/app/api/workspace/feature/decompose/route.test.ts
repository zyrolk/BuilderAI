import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeFeaturePlan } from '../../../../../application/workspace/feature-plan.service';
import { FeaturePlanPersistence } from '../../../../../application/workspace/feature-plan.persistence';

const decompose = vi.fn();
const saveDraft = vi.fn();

vi.mock('../../../../../infrastructure/workspace/local-feature-workflow-runtime', () => ({
  getLocalFeatureDecomposition: () => ({ decompose }),
  getLocalFeatureWorkflow: () => ({ saveDraft }),
}));

async function callDecompose(): Promise<Response> {
  const { POST } = await import('./route');
  return POST(
    new Request('http://localhost:3000/api/workspace/feature/decompose', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'content-length': '24',
      },
      body: JSON.stringify({ request: 'Add checkout flow' }),
    }),
  );
}

const NOW = '2026-08-01T00:00:00.000Z';

function draftPlan() {
  return normalizeFeaturePlan(
    {
      schemaVersion: 1,
      featurePlanId: 'decompose-plan-01',
      sourceRequest: 'Add checkout flow',
      title: 'Checkout',
      summary: 'Summary',
      status: 'DRAFT',
      createdAt: NOW,
      updatedAt: NOW,
      tasks: [
        {
          taskId: 'task-01',
          title: 'Schema',
          objective: 'Add schema',
          scope: 'prisma',
          dependencyIds: [],
          order: 1,
          status: 'PENDING',
        },
      ],
    },
    { now: NOW },
  );
}

describe('POST /api/workspace/feature/decompose', () => {
  afterEach(() => {
    decompose.mockReset();
    saveDraft.mockReset();
  });

  it('persists the decomposed draft before returning it', async () => {
    const draft = draftPlan();
    decompose.mockResolvedValue(draft);
    saveDraft.mockImplementation(async (plan: unknown) => plan);

    const response = await callDecompose();
    expect(response.status).toBe(200);
    expect(saveDraft).toHaveBeenCalledWith(draft);
    const body = (await response.json()) as { featurePlanId: string; status: string };
    expect(body.featurePlanId).toBe('decompose-plan-01');
    expect(body.status).toBe('DRAFT');
  });
});

describe('decompose persistence integration', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('allows immediate approval after decompose persistence with no manual PUT', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-decompose-'));
    roots.push(root);
    const persistence = new FeaturePlanPersistence(root);
    const draft = draftPlan();
    const saved = await persistence.save(draft);
    const loaded = await persistence.load(saved.featurePlanId);
    expect(loaded.status).toBe('DRAFT');
    const approved = normalizeFeaturePlan({ ...loaded, status: 'APPROVED' }, { now: NOW });
    await persistence.save(approved);
    const reloaded = await persistence.load(saved.featurePlanId);
    expect(reloaded.status).toBe('APPROVED');
  });
});
