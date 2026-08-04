import { MANDATORY_PROTECTED_PATH_RULES } from '../../file-apply/config/file-apply-configuration';
import { normalizeProjectPath } from '../../context-builder/internal/path';

function matchesProtectedPath(candidate: string): boolean {
  const normalized = normalizeProjectPath(candidate).toLowerCase();
  for (const rule of MANDATORY_PROTECTED_PATH_RULES) {
    const protectedPath = rule.path.toLowerCase();
    const matched =
      rule.kind === 'EXACT'
        ? normalized === protectedPath
        : rule.kind === 'SUBTREE'
          ? normalized === protectedPath || normalized.startsWith(`${protectedPath}/`)
          : normalized.startsWith(protectedPath);
    if (matched) return true;
  }
  return false;
}

export function isScopeEligiblePath(path: string): boolean {
  return !matchesProtectedPath(path);
}

export function filterScopeEligiblePaths(paths: readonly string[]): readonly string[] {
  return paths.filter(isScopeEligiblePath);
}
