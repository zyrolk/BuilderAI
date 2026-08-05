import type {
  WorkspaceAuthorizationAction,
  WorkspaceAuthorizationContext,
  WorkspaceAuthorizationDecision,
  WorkspacePrincipal,
  WorkspaceRequestSecurityEvidence,
  WorkspaceSecurityConfiguration,
} from './workspace-authorization.types';

export class WorkspaceAuthorizationService {
  constructor(private readonly configuration: WorkspaceSecurityConfiguration) {}

  authorize(context: WorkspaceAuthorizationContext): WorkspaceAuthorizationDecision {
    if (context.principal.projectId !== this.configuration.projectId) {
      return unauthorized('Principal is not authorized for this project workspace.');
    }

    if (this.configuration.profile === 'TRUSTED_LOCAL') {
      return this.authorizeTrustedLocal(context);
    }

    return this.authorizeProtected(context);
  }

  validateApplyAuthorizationToken(
    preparationId: string,
    token: string | undefined,
    store: { readApplyAuthorizationToken(id: string): string | undefined },
  ): WorkspaceAuthorizationDecision {
    if (this.configuration.profile === 'TRUSTED_LOCAL') {
      return { outcome: 'AUTHORIZED' };
    }

    const expected = store.readApplyAuthorizationToken(preparationId);
    if (expected === undefined || token === undefined || token !== expected) {
      return {
        outcome: 'REJECTED',
        code: 'APPLY_AUTHORIZATION_REQUIRED',
        message: 'Server-issued apply authorization is required.',
      };
    }

    return { outcome: 'AUTHORIZED' };
  }

  createTrustedLocalPrincipal(): WorkspacePrincipal {
    return {
      principalId: 'local-operator',
      projectId: this.configuration.projectId,
    };
  }

  private authorizeTrustedLocal(
    context: WorkspaceAuthorizationContext,
  ): WorkspaceAuthorizationDecision {
    if (context.action === 'APPLY' && !context.evidence.operatorApproved) {
      return {
        outcome: 'REJECTED',
        code: 'APPROVAL_REQUIRED',
        message: 'Explicit approval is required.',
      };
    }

    return { outcome: 'AUTHORIZED' };
  }

  private authorizeProtected(
    context: WorkspaceAuthorizationContext,
  ): WorkspaceAuthorizationDecision {
    const bearerToken = context.evidence.bearerToken?.trim();
    if (bearerToken === undefined || bearerToken.length === 0) {
      return {
        outcome: 'REJECTED',
        code: 'UNAUTHENTICATED',
        message: 'An authenticated workspace principal is required.',
      };
    }

    if (bearerToken !== this.configuration.accessToken) {
      return {
        outcome: 'REJECTED',
        code: 'UNAUTHORIZED',
        message: 'The workspace principal is not authorized.',
      };
    }

    if (context.principal.principalId !== this.configuration.principalId) {
      return {
        outcome: 'REJECTED',
        code: 'UNAUTHORIZED',
        message: 'The workspace principal is not authorized.',
      };
    }

    const csrfToken = context.evidence.csrfToken?.trim();
    if (csrfToken === undefined || csrfToken !== this.configuration.csrfToken) {
      return {
        outcome: 'REJECTED',
        code: 'CSRF_VALIDATION_FAILED',
        message: 'Anti-forgery validation failed.',
      };
    }

    if (context.action === 'APPLY' && !context.evidence.operatorApproved) {
      return {
        outcome: 'REJECTED',
        code: 'APPROVAL_REQUIRED',
        message: 'Explicit approval is required.',
      };
    }

    return { outcome: 'AUTHORIZED' };
  }
}

function unauthorized(message: string): WorkspaceAuthorizationDecision {
  return {
    outcome: 'REJECTED',
    code: 'UNAUTHORIZED',
    message,
  };
}

export function createWorkspaceAuthorizationContext(input: {
  readonly configuration: WorkspaceSecurityConfiguration;
  readonly action: WorkspaceAuthorizationAction;
  readonly evidence: WorkspaceRequestSecurityEvidence;
  readonly principal?: WorkspacePrincipal;
}): WorkspaceAuthorizationContext {
  return {
    profile: input.configuration.profile,
    action: input.action,
    principal:
      input.principal ??
      (input.configuration.profile === 'TRUSTED_LOCAL'
        ? { principalId: 'local-operator', projectId: input.configuration.projectId }
        : {
            principalId: input.configuration.principalId,
            projectId: input.configuration.projectId,
          }),
    evidence: input.evidence,
  };
}
