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
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('passes AbortSignal on PREPARE and maps AbortError to PROVIDER_CANCELLED', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();
    const pending = workflow.prepare('Create the file.');
    await Promise.resolve();
    workflow.abortInFlight();
    workflow.abortInFlight();
    await expect(pending).rejects.toMatchObject({
      code: 'PROVIDER_CANCELLED',
      message: 'Request cancelled.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts in-flight APPLY without treating cancellation as a generic failure', async () => {
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
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();
    const prepared = await workflow.prepare('Create the file.');
    const pending = workflow.apply(prepared.changePlan);
    await Promise.resolve();
    workflow.abortInFlight();
    await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' });
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

  it('sends only the investigation reference for a Prepare Fix request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        preparationId: '123e4567-e89b-12d3-a456-426614174000',
        responsePackage: RESPONSE_PACKAGE,
        changePlan: CHANGE_PLAN,
        gate2Review: GATE2_REVIEW,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();

    await workflow.prepare('Fix the supplier regression.', {
      investigationId: 'investigation-123',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/prepare',
      expect.objectContaining({
        body: JSON.stringify({
          request: 'Fix the supplier regression.',
          investigationId: 'investigation-123',
        }),
      }),
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

  it('passes feature binding and correction options through prepare', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        preparationId: '123e4567-e89b-12d3-a456-426614174000',
        responsePackage: RESPONSE_PACKAGE,
        changePlan: CHANGE_PLAN,
        gate2Review: GATE2_REVIEW,
        featurePlan: {
          schemaVersion: 1,
          featurePlanId: 'plan-1',
          sourceRequest: 'Feature',
          title: 'Feature',
          summary: 'Summary',
          status: 'APPROVED',
          createdAt: '2026-08-20T12:00:00.000Z',
          updatedAt: '2026-08-20T12:00:00.000Z',
          tasks: [],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();
    const prepared = await workflow.prepare('Implement task', {
      featurePlanId: 'plan-1',
      taskId: 'task-1',
      dependencyOverrides: ['task-0'],
      correctionWorkflowId: 'corr-1',
    });
    expect(prepared.featurePlan?.featurePlanId).toBe('plan-1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspace/prepare',
      expect.objectContaining({
        body: expect.stringContaining('"correctionWorkflowId":"corr-1"'),
      }),
    );
  });

  it('builds Gate2 preservation and completion corrections', async () => {
    const payload = {
      preparationId: '123e4567-e89b-12d3-a456-426614174001',
      responsePackage: RESPONSE_PACKAGE,
      changePlan: CHANGE_PLAN,
      gate2Review: GATE2_REVIEW,
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response(payload)));
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();
    await workflow.prepare('Create the file.');
    const gate2Corrected = await workflow.prepareGate2PreservationCorrection(
      'Preserve surgical edits',
      CHANGE_PLAN,
      '123e4567-e89b-12d3-a456-426614174000',
      'Too much churn',
    );
    expect(gate2Corrected.isCorrection).toBe(true);
    expect(gate2Corrected.sourcePreparationId).toBe('123e4567-e89b-12d3-a456-426614174000');

    const completionCorrected = await workflow.prepareCorrection('Fix verification', {
      applyResult: APPLY_RESULT,
      verificationReport: VERIFICATION_REPORT,
      sourcePreparationId: '123e4567-e89b-12d3-a456-426614174000',
      priorRequestSummary: 'Create the file.',
      featurePlanId: 'plan-1',
      taskId: 'task-1',
    });
    expect(completionCorrected.isCorrection).toBe(true);
  });

  it('rejects verify without a matching report', async () => {
    const workflow = new HttpWorkspaceWorkflow();
    await expect(workflow.verify(APPLY_RESULT)).rejects.toThrow(
      'No matching verification report is available.',
    );
  });

  it('rejects apply without a matching preparation', async () => {
    const workflow = new HttpWorkspaceWorkflow();
    await expect(workflow.apply(CHANGE_PLAN)).rejects.toThrow(
      'No matching server preparation is available.',
    );
  });

  it('rejects invalid activity history and project memory payloads', async () => {
    const workflow = new HttpWorkspaceWorkflow();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null)));
    await expect(workflow.loadActivityHistory()).rejects.toThrow(
      'Invalid activity history response.',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ schemaVersion: 2, activities: [] })),
    );
    await expect(workflow.loadActivityHistory()).rejects.toThrow(
      'Invalid activity history response.',
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ schemaVersion: 1 })));
    await expect(workflow.loadProjectMemory()).rejects.toThrow('Invalid project memory response.');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(null)));
    await expect(workflow.loadProjectMemory()).rejects.toThrow('Invalid project memory response.');
  });

  it('maps activity-history HTTP failures and loads valid history', async () => {
    const workflow = new HttpWorkspaceWorkflow();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ code: 'FORBIDDEN', message: 'Denied.' }, 403)),
    );
    await expect(workflow.loadActivityHistory()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Denied.',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response({
          schemaVersion: 1,
          activities: [],
        }),
      ),
    );
    expect(await workflow.loadActivityHistory()).toEqual({ schemaVersion: 1, activities: [] });
  });

  it('applies with runtime browser verification in completion payload', async () => {
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
        response({
          applyResult: APPLY_RESULT,
          verificationReport: VERIFICATION_REPORT,
          runtimeBrowserVerificationReport: {
            schemaVersion: 1,
            status: 'PASSED',
            server: {
              descriptorId: 'next-dev',
              status: 'READY',
              startupDurationMs: 1,
            },
            browser: {
              status: 'PASSED',
              durationMs: 1,
              routes: [],
              consoleErrorCount: 0,
              pageExceptionCount: 0,
              failedRequestCount: 0,
            },
            durationMs: 2,
            metadata: {},
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const workflow = new HttpWorkspaceWorkflow();
    const prepared = await workflow.prepare('Create the file.');
    const applied = await workflow.apply(prepared.changePlan);
    expect(applied.status).toBe('APPLIED');
    expect(workflow.getCompletionSnapshot()?.runtimeBrowserVerificationReport?.status).toBe(
      'PASSED',
    );
  });
});

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
