import {
  createWorkspaceAuthorizationContext,
  WorkspaceAuthorizationService,
} from '../../application/workspace/workspace-authorization.service';
import type {
  WorkspaceAuthorizationAction,
  WorkspaceRequestSecurityEvidence,
  WorkspaceSecurityConfiguration,
} from '../../application/workspace/workspace-authorization.types';
import { toWorkspaceRuntimeErrorFromAuthorization } from './workspace-route-errors';

const AUTHORIZATION_HEADER = 'authorization';
const CSRF_HEADER = 'x-builderai-csrf-token';

export function readWorkspaceRequestSecurityEvidence(
  request: Request,
  body: unknown,
  action: WorkspaceAuthorizationAction,
): WorkspaceRequestSecurityEvidence {
  const approved =
    typeof body === 'object' && body !== null && Reflect.get(body, 'approved') === true;
  const applyAuthorizationToken = readStringField(body, 'applyAuthorizationToken');

  return {
    bearerToken: readBearerToken(request.headers.get(AUTHORIZATION_HEADER)),
    csrfToken: readOptionalHeader(request.headers.get(CSRF_HEADER)),
    operatorApproved:
      action === 'PREPARE' ||
      action === 'INVESTIGATE' ||
      action === 'MEMORY_WRITE' ||
      action === 'READINESS'
        ? true
        : approved,
    applyAuthorizationToken,
  };
}

export function authorizeWorkspaceRequest(input: {
  readonly security: WorkspaceSecurityConfiguration;
  readonly request: Request;
  readonly body: unknown;
  readonly action: WorkspaceAuthorizationAction;
}): ReturnType<WorkspaceAuthorizationService['authorize']> {
  const authorization = new WorkspaceAuthorizationService(input.security);
  const evidence = readWorkspaceRequestSecurityEvidence(input.request, input.body, input.action);
  const context = createWorkspaceAuthorizationContext({
    configuration: input.security,
    action: input.action,
    evidence,
  });
  return authorization.authorize(context);
}

export function assertAuthorizedWorkspaceRequest(input: {
  readonly security: WorkspaceSecurityConfiguration;
  readonly request: Request;
  readonly body: unknown;
  readonly action: WorkspaceAuthorizationAction;
}): void {
  const decision = authorizeWorkspaceRequest(input);
  if (decision.outcome === 'AUTHORIZED') return;
  throw toWorkspaceRuntimeErrorFromAuthorization({
    code: decision.code ?? 'UNAUTHORIZED',
    message: decision.message ?? 'The workspace request is not authorized.',
  });
}

function readBearerToken(value: string | null): string | undefined {
  if (value === null) return undefined;
  const match = /^Bearer\s+(.+)$/iu.exec(value.trim());
  return match?.[1]?.trim();
}

function readOptionalHeader(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function readStringField(value: unknown, name: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = Reflect.get(value, name);
  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}
