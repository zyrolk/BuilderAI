import {
  WorkspaceRuntimeError,
  type WorkspaceRuntimeError as WorkspaceRuntimeErrorType,
} from '../../application/workspace/workspace-runtime.types';

export function mapWorkspaceRuntimeErrorStatus(
  error: WorkspaceRuntimeErrorType,
): number | undefined {
  switch (error.code) {
    case 'INVALID_REQUEST':
    case 'INVALID_ITERATION_FEEDBACK':
    case 'INVALID_FEATURE_PLAN':
    case 'APPROVAL_REQUIRED':
      return 400;
    case 'UNAUTHENTICATED':
      return 401;
    case 'UNAUTHORIZED':
    case 'CSRF_VALIDATION_FAILED':
      return 403;
    case 'PREPARATION_NOT_FOUND':
    case 'PREPARATION_EXPIRED':
    case 'APPLY_PATH_CONFLICT':
    case 'APPLY_AUTHORIZATION_REQUIRED':
    case 'BASELINE_INTEGRITY_REQUIRED':
      return 409;
    default:
      return undefined;
  }
}

export function toWorkspaceRuntimeErrorFromAuthorization(input: {
  readonly code: NonNullable<WorkspaceRuntimeErrorType['code']>;
  readonly message: string;
}): WorkspaceRuntimeError {
  return new WorkspaceRuntimeError(input.code, input.message);
}
