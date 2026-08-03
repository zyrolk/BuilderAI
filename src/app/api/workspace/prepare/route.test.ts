import { WorkspaceRuntimeError } from '../../../../application/workspace';
import {
  InvalidProviderConfigurationError,
  ProviderCancelledError,
  ProviderContractViolationError,
  ProviderOutputTruncatedError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  UnsupportedCapabilityError,
} from '../../../../core/ai-provider';
import { ChangePlanValidationError } from '../../../../core/change-planner';
import { ContextBuilderValidationError } from '../../../../core/context-builder';
import { PromptOrchestratorValidationError } from '../../../../core/prompt-orchestrator';
import { ResponseProcessorValidationError } from '../../../../core/response-processor';

const prepare = vi.fn();

vi.mock('../../../../infrastructure/workspace/local-feature-workflow-runtime', () => ({
  getLocalWorkspaceRuntime: () => ({ prepare }),
  getLocalFeatureWorkflow: () => ({ prepareTask: vi.fn() }),
}));

async function callPost(): Promise<Response> {
  const { POST } = await import('./route');
  const request = new Request('http://localhost:3000/api/workspace/prepare', {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ request: 'do something' }),
  });
  return POST(request);
}

describe('POST /api/workspace/prepare error handling', () => {
  beforeEach(() => {
    prepare.mockReset();
  });

  it('maps ContextBuilderValidationError to a 422 response with code, message, and issues', async () => {
    const issues = [
      { code: 'MISSING_REQUIRED_CONTEXT' as const, path: '$.currentTask', message: 'is required' },
    ];
    prepare.mockRejectedValueOnce(new ContextBuilderValidationError(issues));

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string; issues: unknown };

    expect(response.status).toBe(422);
    expect(payload.code).toBe('CONTEXT_BUILDER_VALIDATION_FAILED');
    expect(payload.message).toContain('$.currentTask: is required');
    expect(payload.issues).toEqual(issues);
  });

  it('maps PromptOrchestratorValidationError to a 422 response with code, message, and issues', async () => {
    const issues = [
      {
        code: 'PROMPT_SIZE_EXCEEDED' as const,
        path: '$.maximumCharacters',
        message: 'required prompt sections need 1 characters but the limit is 0',
      },
    ];
    prepare.mockRejectedValueOnce(new PromptOrchestratorValidationError(issues));

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string; issues: unknown };

    expect(response.status).toBe(422);
    expect(payload.code).toBe('PROMPT_ORCHESTRATOR_VALIDATION_FAILED');
    expect(payload.message).toContain(
      '$.maximumCharacters: required prompt sections need 1 characters but the limit is 0',
    );
    expect(payload.issues).toEqual(issues);
  });

  it('maps ResponseProcessorValidationError to a 422 response with code, message, and issues', async () => {
    const issues = [
      {
        code: 'INVALID_RESPONSE_PACKAGE' as const,
        path: '$.manifest',
        message: 'must be an object',
      },
    ];
    prepare.mockRejectedValueOnce(new ResponseProcessorValidationError(issues));

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string; issues: unknown };

    expect(response.status).toBe(422);
    expect(payload.code).toBe('RESPONSE_PROCESSOR_VALIDATION_FAILED');
    expect(payload.message).toContain('$.manifest: must be an object');
    expect(payload.issues).toEqual(issues);
  });

  it('maps ChangePlanValidationError to a 422 response with code, message, and issues', async () => {
    const issues = [
      {
        code: 'INVALID_CHANGE_PLAN' as const,
        path: '$.changeSet',
        message: 'must be an object',
      },
    ];
    prepare.mockRejectedValueOnce(new ChangePlanValidationError(issues));

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string; issues: unknown };

    expect(response.status).toBe(422);
    expect(payload.code).toBe('CHANGE_PLAN_VALIDATION_FAILED');
    expect(payload.message).toContain('$.changeSet: must be an object');
    expect(payload.issues).toEqual(issues);
  });

  it('maps ProviderContractViolationError to a 422 response with code, message, and issues', async () => {
    const issues = [
      {
        path: '$.request.prompt',
        message: 'serialized size 250000 exceeds the configured maximumInputCharacters of 200000',
      },
    ];
    prepare.mockRejectedValueOnce(new ProviderContractViolationError('REQUEST', issues));

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string; issues: unknown };

    expect(response.status).toBe(422);
    expect(payload.code).toBe('CONTRACT_VIOLATION');
    expect(payload.message).not.toContain('secret-provider-text');
    expect(payload.issues).toEqual(issues);
  });

  it.each([
    ['OUTPUT_TRUNCATED', new ProviderOutputTruncatedError('google-gemini'), 422],
    ['PROVIDER_UNAVAILABLE', new ProviderUnavailableError('google-gemini'), 503],
    ['TIMEOUT', new ProviderTimeoutError('google-gemini', 120_000), 504],
    ['CANCELLED', new ProviderCancelledError('execution-one', 'stopped'), 422],
    ['UNSUPPORTED_CAPABILITY', new UnsupportedCapabilityError('google-gemini', ['STREAMING']), 422],
  ] as const)(
    'maps %s to a typed provider response without leaking raw output',
    async (_label, error, status) => {
      prepare.mockRejectedValueOnce(error);

      const response = await callPost();
      const payload = (await response.json()) as {
        code: string;
        message: string;
        issues?: unknown;
      };

      expect(response.status).toBe(status);
      expect(payload.code).toBe(error.code);
      expect(payload.message).toBe(error.message);
      expect(JSON.stringify(payload)).not.toMatch(/raw|stdout|stderr|apikey|secret/i);
      expect(payload.issues).toBeUndefined();
    },
  );

  it('maps InvalidProviderConfigurationError to a 422 response with issues', async () => {
    prepare.mockRejectedValueOnce(
      new InvalidProviderConfigurationError([{ path: '$.model', message: 'unsupported' }]),
    );

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string; issues: unknown };

    expect(response.status).toBe(422);
    expect(payload.code).toBe('INVALID_CONFIGURATION');
    expect(payload.issues).toHaveLength(1);
  });

  it('maps WorkspaceRuntimeError with INVALID_ITERATION_FEEDBACK code to a 400 response', async () => {
    prepare.mockRejectedValueOnce(
      new WorkspaceRuntimeError(
        'INVALID_ITERATION_FEEDBACK',
        'iteration feedback schemaVersion must be 1',
      ),
    );

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      code: 'INVALID_ITERATION_FEEDBACK',
      message: 'iteration feedback schemaVersion must be 1',
    });
  });

  it('maps WorkspaceRuntimeError with INVALID_REQUEST code to a 400 response', async () => {
    prepare.mockRejectedValueOnce(new WorkspaceRuntimeError('INVALID_REQUEST', 'bad request'));

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(400);
    expect(payload).toEqual({ code: 'INVALID_REQUEST', message: 'bad request' });
  });

  it('maps other WorkspaceRuntimeError codes to a 422 response', async () => {
    prepare.mockRejectedValueOnce(
      new WorkspaceRuntimeError('PROJECT_CONTEXT_INVALID', 'context invalid'),
    );

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(422);
    expect(payload).toEqual({ code: 'PROJECT_CONTEXT_INVALID', message: 'context invalid' });
  });

  it('maps a generic Error to a 500 response with a generic message', async () => {
    prepare.mockRejectedValueOnce(new Error('boom'));

    const response = await callPost();
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(500);
    expect(payload.code).toBe('INTERNAL_WORKFLOW_ERROR');
    expect(payload.message).not.toContain('boom');
  });

  it('maps LocalRequestRejectedError to a 403 response before invoking prepare', async () => {
    const { POST } = await import('./route');
    const request = new Request('http://localhost:3000/api/workspace/prepare', {
      method: 'POST',
      headers: { origin: 'http://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ request: 'do something' }),
    });

    const response = await POST(request);
    const payload = (await response.json()) as { code: string; message: string };

    expect(response.status).toBe(403);
    expect(payload.code).toBe('LOCAL_REQUEST_REJECTED');
    expect(prepare).not.toHaveBeenCalled();
  });

  it('returns the preparation payload with a 200 status on success', async () => {
    prepare.mockResolvedValueOnce({ preparationId: 'prep-1' });

    const response = await callPost();
    const payload = (await response.json()) as { preparationId: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ preparationId: 'prep-1' });
  });
});
