export const WORKSPACE_SECURITY_PROFILES = ['TRUSTED_LOCAL', 'PROTECTED'] as const;
export type WorkspaceSecurityProfile = (typeof WORKSPACE_SECURITY_PROFILES)[number];

export const WORKSPACE_AUTHORIZATION_ACTIONS = [
  'PREPARE',
  'APPLY',
  'INVESTIGATE',
  'MEMORY_WRITE',
  'READINESS',
  'GIT_WRITE',
  'BROWSER_OBSERVE',
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
  /** Distinct from Gate2 apply tokens and Git operatorApproved (ADR-043). */
  readonly browserObservationApproved?: boolean;
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
    | 'APPROVAL_REQUIRED'
    | 'OPERATOR_APPROVAL_REQUIRED'
    | 'BROWSER_OPERATOR_APPROVAL_REQUIRED';
  readonly message?: string;
}
