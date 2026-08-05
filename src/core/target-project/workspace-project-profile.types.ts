export const WORKSPACE_PROJECT_PROFILES = ['BUILDERAI_SELF', 'EXTERNAL_TARGET'] as const;

export type WorkspaceProjectProfile = (typeof WORKSPACE_PROJECT_PROFILES)[number];

export interface WorkspaceProjectProfileConfiguration {
  readonly profile: WorkspaceProjectProfile;
}
