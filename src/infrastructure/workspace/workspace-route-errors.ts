import {
  WorkspaceRuntimeError,
  type WorkspaceRuntimeError as WorkspaceRuntimeErrorType,
} from '../../application/workspace/workspace-runtime.types';

export function mapWorkspaceRuntimeErrorStatus(
  error: WorkspaceRuntimeErrorType,
): number | undefined {
  switch (error.code) {
    case 'EXTERNAL_TARGET_ONBOARDING_REQUIRED':
    case 'EXTERNAL_TARGET_READINESS_BLOCKED':
    case 'PROJECT_CONTEXT_INVALID':
      return 422;
    case 'INVALID_REQUEST':
    case 'INVALID_ITERATION_FEEDBACK':
    case 'INVESTIGATION_REFERENCE_INVALID':
    case 'INVALID_FEATURE_PLAN':
    case 'APPROVAL_REQUIRED':
      return 400;
    case 'UNAUTHENTICATED':
      return 401;
    case 'UNAUTHORIZED':
    case 'OPERATOR_APPROVAL_REQUIRED':
    case 'CSRF_VALIDATION_FAILED':
      return 403;
    case 'PREPARATION_NOT_FOUND':
    case 'PREPARATION_EXPIRED':
    case 'APPLY_PATH_CONFLICT':
    case 'APPLY_AUTHORIZATION_REQUIRED':
    case 'BASELINE_INTEGRITY_REQUIRED':
      return 409;
    case 'PROVIDER_RATE_LIMITED':
      return 429;
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_TIMEOUT':
      return 503;
    case 'PROVIDER_CANCELLED':
      return 499;
    case 'OUTPUT_TRUNCATED':
    case 'INVALID_PROVIDER_RESPONSE':
      return 502;
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
