export const WORKSPACE_SECURITY_PROFILES = ['TRUSTED_LOCAL', 'PROTECTED'] as const;
export type WorkspaceSecurityProfile = (typeof WORKSPACE_SECURITY_PROFILES)[number];

export const WORKSPACE_AUTHORIZATION_ACTIONS = [
  'PREPARE',
  'APPLY',
  'INVESTIGATE',
  'MEMORY_WRITE',
] as const;
export type WorkspaceAuthorizationAction = (typeof WORKSPACE_AUTHORIZATION_ACTIONS)[number];

export interface WorkspacePrincipal {
  readonly principalId: string;
  readonly projectId: string;
}

export interface WorkspaceSecurityConfiguration {
  readonly profile: WorkspaceSecurityProfile;
  readonly projectId: string;
  readonly accessToken?: string;
  readonly csrfToken?: string;
  readonly principalId: string;
}

export interface WorkspaceRequestSecurityEvidence {
  readonly bearerToken?: string;
  readonly csrfToken?: string;
  readonly operatorApproved: boolean;
  readonly applyAuthorizationToken?: string;
}

export interface WorkspaceAuthorizationContext {
  readonly profile: WorkspaceSecurityProfile;
  readonly principal: WorkspacePrincipal;
  readonly action: WorkspaceAuthorizationAction;
  readonly evidence: WorkspaceRequestSecurityEvidence;
}

export type WorkspaceAuthorizationOutcome = 'AUTHORIZED' | 'REJECTED';

export interface WorkspaceAuthorizationDecision {
  readonly outcome: WorkspaceAuthorizationOutcome;
  readonly code?:
    | 'UNAUTHENTICATED'
    | 'UNAUTHORIZED'
    | 'CSRF_VALIDATION_FAILED'
    | 'APPLY_AUTHORIZATION_REQUIRED'
    | 'APPROVAL_REQUIRED';
  readonly message?: string;
}
