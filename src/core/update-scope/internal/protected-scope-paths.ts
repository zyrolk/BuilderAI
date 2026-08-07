import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../target-project/workspace-path-protection';

export function isScopeEligiblePath(
  candidate: string,
  policy: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
): boolean {
  return policy.isContentEligible(candidate);
}

export function filterScopeEligiblePaths(
  paths: readonly string[],
  policy: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
): readonly string[] {
  return paths.filter((path) => isScopeEligiblePath(path, policy));
}
