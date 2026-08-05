import { WorkspaceRuntimeError } from '../../application/workspace';
import {
  mapWorkspaceRuntimeErrorStatus,
  toWorkspaceRuntimeErrorFromAuthorization,
} from './workspace-route-errors';

describe('workspace route errors', () => {
  it('maps authorization and apply boundary codes to HTTP statuses', () => {
    expect(mapWorkspaceRuntimeErrorStatus(new WorkspaceRuntimeError('INVALID_REQUEST', 'x'))).toBe(
      400,
    );
    expect(mapWorkspaceRuntimeErrorStatus(new WorkspaceRuntimeError('UNAUTHENTICATED', 'x'))).toBe(
      401,
    );
    expect(mapWorkspaceRuntimeErrorStatus(new WorkspaceRuntimeError('UNAUTHORIZED', 'x'))).toBe(
      403,
    );
    expect(
      mapWorkspaceRuntimeErrorStatus(new WorkspaceRuntimeError('CSRF_VALIDATION_FAILED', 'x')),
    ).toBe(403);
    expect(
      mapWorkspaceRuntimeErrorStatus(new WorkspaceRuntimeError('APPLY_PATH_CONFLICT', 'x')),
    ).toBe(409);
    expect(
      mapWorkspaceRuntimeErrorStatus(new WorkspaceRuntimeError('BASELINE_INTEGRITY_REQUIRED', 'x')),
    ).toBe(409);
  });

  it('returns undefined for workflow errors handled by existing route semantics', () => {
    expect(
      mapWorkspaceRuntimeErrorStatus(new WorkspaceRuntimeError('PROJECT_CONTEXT_INVALID', 'x')),
    ).toBeUndefined();
  });

  it('wraps authorization decisions into workspace runtime errors', () => {
    const error = toWorkspaceRuntimeErrorFromAuthorization({
      code: 'UNAUTHORIZED',
      message: 'not allowed',
    });
    expect(error).toBeInstanceOf(WorkspaceRuntimeError);
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.message).toBe('not allowed');
  });
});
