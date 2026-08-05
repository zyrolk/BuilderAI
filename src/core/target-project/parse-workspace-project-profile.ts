import type { WorkspaceProjectProfile } from './workspace-project-profile.types';

const PROFILE_ALIASES: Readonly<Record<string, WorkspaceProjectProfile>> = {
  'builderai-self': 'BUILDERAI_SELF',
  builderai_self: 'BUILDERAI_SELF',
  self: 'BUILDERAI_SELF',
  'external-target': 'EXTERNAL_TARGET',
  external_target: 'EXTERNAL_TARGET',
  external: 'EXTERNAL_TARGET',
};

export function parseWorkspaceProjectProfile(raw: string | undefined): WorkspaceProjectProfile {
  if (raw === undefined || raw.trim().length === 0) return 'BUILDERAI_SELF';
  const normalized = raw.trim().toLowerCase();
  const profile = PROFILE_ALIASES[normalized];
  if (profile === undefined) {
    throw new Error(
      "BUILDERAI_WORKSPACE_PROJECT_PROFILE must equal 'builderai-self' or 'external-target'.",
    );
  }
  return profile;
}

export function readWorkspaceProjectProfileFromEnvironment(): WorkspaceProjectProfile {
  return parseWorkspaceProjectProfile(process.env.BUILDERAI_WORKSPACE_PROJECT_PROFILE);
}
