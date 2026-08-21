import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpFeatureWorkflow } from '../http-feature-workflow';
import { WorkspaceWorkflowError } from '../workspace.types';

const PLAN = {
  schemaVersion: 1,
  featurePlanId: 'plan-1',
  sourceRequest: 'Feature',
  title: 'Feature',
  summary: 'Summary',
  status: 'APPROVED',
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
  tasks: [],
} as const;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('HttpFeatureWorkflow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads active and specific plans', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ plan: PLAN }))
      .mockResolvedValueOnce(jsonResponse({ plan: null }))
      .mockResolvedValueOnce(jsonResponse({ plan: PLAN }))
      .mockResolvedValueOnce(jsonResponse({ plan: null }));
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpFeatureWorkflow();
    expect(await workflow.loadActivePlan()).toEqual(PLAN);
    expect(await workflow.loadActivePlan()).toBeUndefined();
    expect(await workflow.loadPlan('plan-1')).toEqual(PLAN);
    await expect(workflow.loadPlan('missing')).rejects.toThrow(WorkspaceWorkflowError);
  });

  it('decomposes, saves draft, and approves plans', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(PLAN))
      .mockResolvedValueOnce(jsonResponse({ plan: PLAN }))
      .mockResolvedValueOnce(jsonResponse({ plan: PLAN }));
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpFeatureWorkflow();
    expect(await workflow.decompose('Add feature')).toEqual(PLAN);
    expect(await workflow.saveDraft(PLAN as never)).toEqual(PLAN);
    expect(await workflow.approvePlan('plan-1')).toEqual(PLAN);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/feature/plan',
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('completes, fails, skips, and reopens tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ plan: PLAN }));
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpFeatureWorkflow();
    expect(await workflow.completeTask('plan-1', 'task-1', { summary: 'done' }, true)).toEqual(
      PLAN,
    );
    expect(await workflow.failTask('plan-1', 'task-1', { summary: 'failed' })).toEqual(PLAN);
    expect(await workflow.skipTask('plan-1', 'task-1', 'skip')).toEqual(PLAN);
    expect(await workflow.reopenTask('plan-1', 'task-1')).toEqual(PLAN);
  });

  it('maps unsuccessful HTTP responses to WorkspaceWorkflowError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 'INVALID_FEATURE_PLAN', message: 'Bad plan.' }, false, 400),
        ),
    );
    const workflow = new HttpFeatureWorkflow();
    await expect(workflow.decompose('x')).rejects.toMatchObject({
      code: 'INVALID_FEATURE_PLAN',
      message: 'Bad plan.',
    });
  });

  it('falls back to default error code/message when payload lacks them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
    const workflow = new HttpFeatureWorkflow();
    await expect(workflow.approvePlan('plan-1')).rejects.toMatchObject({
      code: 'WORKFLOW_FAILED',
      message: 'Request failed.',
    });
  });
});
