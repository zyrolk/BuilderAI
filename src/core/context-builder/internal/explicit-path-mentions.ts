import { normalizeProjectPath } from './path';
import { isScopeEligiblePath } from '../../update-scope/internal/protected-scope-paths';

const LOGICAL_PATH_PATTERN =
  /\b(?:[\w.-]+\/)*[\w.-]+\.(?:html?|css|(?:c|m)?js|jsx|tsx?|json|md|rules)\b/giu;

function comparePath(left: string, right: string): number {
  return left.localeCompare(right);
}

function normalizeExistingPath(path: string, sourcePaths: readonly string[]): string | undefined {
  const normalized = normalizeProjectPath(path);
  if (!isScopeEligiblePath(normalized)) return undefined;
  const available = new Set(sourcePaths.map((value) => normalizeProjectPath(value)));
  if (available.has(normalized)) return normalized;
  const basename = normalized.split('/').at(-1);
  if (basename === undefined) return undefined;
  const matches = [...available].filter(
    (candidate) => candidate.endsWith(`/${basename}`) || candidate === basename,
  );
  if (matches.length === 1) return matches[0];
  return undefined;
}

export function resolveExistingSourcePath(
  path: string,
  sourcePaths: readonly string[],
): string | undefined {
  return normalizeExistingPath(path, sourcePaths);
}

export function extractExplicitPathMentions(
  taskText: string,
  sourcePaths: readonly string[],
): readonly string[] {
  const paths = new Set<string>();
  for (const match of taskText.matchAll(LOGICAL_PATH_PATTERN)) {
    const resolved = normalizeExistingPath(match[0], sourcePaths);
    if (resolved !== undefined) paths.add(resolved);
  }
  return [...paths].sort(comparePath);
}

export function mergeExplicitPathsIntoShortlist(
  shortlist: readonly string[],
  explicitPaths: readonly string[],
  capacity: number,
): readonly string[] {
  if (explicitPaths.length === 0) return shortlist;
  const merged = [...shortlist];
  const present = new Set(merged);
  for (const explicitPath of explicitPaths) {
    if (present.has(explicitPath)) continue;
    if (merged.length < capacity) {
      merged.unshift(explicitPath);
    } else {
      merged.pop();
      merged.unshift(explicitPath);
    }
    present.add(explicitPath);
  }
  return merged.slice(0, capacity);
}
