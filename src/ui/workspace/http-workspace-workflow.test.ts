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
});

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
