import {
  APPLY_RESULT,
  CHANGE_PLAN,
  GATE2_REVIEW,
  RESPONSE_PACKAGE,
  VERIFICATION_REPORT,
} from './test/workspace.fixture';
import { HttpWorkspaceWorkflow } from './http-workspace-workflow';

describe('HttpWorkspaceWorkflow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses an opaque preparation identifier and returns validated server evidence', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          preparationId: '123e4567-e89b-12d3-a456-426614174000',
          responsePackage: RESPONSE_PACKAGE,
          changePlan: CHANGE_PLAN,
          gate2Review: GATE2_REVIEW,
        }),
      )
      .mockResolvedValueOnce(
        response({ applyResult: APPLY_RESULT, verificationReport: VERIFICATION_REPORT }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();

    const prepared = await workflow.prepare('Create the file.');
    const applied = await workflow.apply(prepared.changePlan);
    const verified = await workflow.verify(applied);

    expect(verified.status).toBe('PASSED');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/workspace/apply',
      expect.objectContaining({
        body: JSON.stringify({
          preparationId: '123e4567-e89b-12d3-a456-426614174000',
          approved: true,
        }),
      }),
    );
  });

  it('rejects malformed and unsuccessful server responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          response(
            { code: 'CONTEXT_BUILDER_VALIDATION_FAILED', message: 'Runtime disabled.' },
            422,
          ),
        ),
    );
    const workflow = new HttpWorkspaceWorkflow();
    await expect(workflow.prepare('Create the file.')).rejects.toMatchObject({
      code: 'CONTEXT_BUILDER_VALIDATION_FAILED',
      message: 'Runtime disabled.',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ preparationId: 'bad' })));
    await expect(workflow.prepare('Create the file.')).rejects.toThrow(
      'Invalid preparation identifier.',
    );
  });

  it('loads and saves project memory through workspace endpoints', async () => {
    const memoryPayload = {
      schemaVersion: 1,
      projectId: 'zyro-style-fixture',
      updatedAt: '2026-08-05T12:00:00.000Z',
      decisions: [],
      completedWork: [],
      investigations: [
        {
          id: 'inv-1',
          category: 'INVESTIGATION',
          createdAt: '2026-08-05T12:00:00.000Z',
          updatedAt: '2026-08-05T12:00:00.000Z',
          summary: 'Supplier Hub cancellation depends on shared validation.',
          supportingPaths: ['server/services/order-cancellation.service.ts'],
          source: 'INVESTIGATION_SAVE',
          investigationId: 'inv-1',
          confidence: 'MEDIUM',
          affectedAreas: ['server/services/order-cancellation.service.ts'],
        },
      ],
      findings: [],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(memoryPayload))
      .mockResolvedValueOnce(response(memoryPayload))
      .mockResolvedValueOnce(response(memoryPayload));
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();

    const loaded = await workflow.loadProjectMemory();
    expect(loaded.investigations).toHaveLength(1);

    await workflow.saveInvestigationMemory({
      investigationId: 'inv-2',
      requestSummary: 'Supplier cancellation bug',
      summary: 'Shared validation service participates in cancellation.',
      confidence: 'LOW',
      affectedAreas: ['server/services/order-cancellation.service.ts'],
      recommendedNextSteps: ['Review cancellation service status updates.'],
    });
    await workflow.saveOperatorMemory({
      category: 'DECISION',
      summary: 'Supplier cancellation must preserve audit trail.',
      supportingPaths: ['server/routes/supplier-orders.ts'],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/memory',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/memory',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"category":"INVESTIGATION"'),
      }),
    );
  });
});

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
