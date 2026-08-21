import {
  normalizeProjectPath,
  resolveRelativePath,
} from '../../../core/context-builder/internal/path';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';

const IMPORT_SPECIFIER_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gu;

const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'] as const;

export const IMPORT_INSPECTION_MAX = 24 as const;

export interface ImportInspectionEntry {
  readonly specifier: string;
  readonly relative: boolean;
  readonly resolvedPath?: string;
}

export interface ImportInspectionResult {
  readonly fromPath: string;
  readonly imports: readonly ImportInspectionEntry[];
  readonly truncated: boolean;
}

export function inspectRelativeImports(input: {
  readonly fromPath: string;
  readonly content: string;
  readonly sourcePaths: readonly string[];
  readonly maximumImports?: number;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
}): ImportInspectionResult {
  const maximumImports = Math.min(
    input.maximumImports ?? IMPORT_INSPECTION_MAX,
    IMPORT_INSPECTION_MAX,
  );
  const pathProtection = input.pathProtection ?? DEFAULT_WORKSPACE_PATH_PROTECTION;
  const fromPath = normalizeProjectPath(input.fromPath);
  const availablePaths = new Set(
    input.sourcePaths
      .filter((path) => isScopeEligiblePath(path, pathProtection))
      .map((path) => normalizeProjectPath(path)),
  );
  const fromDirectory = directory(fromPath);
  const imports: ImportInspectionEntry[] = [];
  let truncated = false;

  for (const match of input.content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    const relative = specifier.startsWith('.');
    let resolvedPath: string | undefined;
    if (relative) {
      const resolved = resolveRelativePath(fromDirectory, specifier);
      resolvedPath = findImportedPath(resolved, availablePaths);
    }
    imports.push({ specifier, relative, resolvedPath });
    if (imports.length >= maximumImports) {
      truncated = true;
      break;
    }
  }

  return { fromPath, imports, truncated };
}

function findImportedPath(
  importPath: string,
  availablePaths: ReadonlySet<string>,
): string | undefined {
  for (const suffix of SOURCE_SUFFIXES) {
    const candidate = `${importPath}${suffix}`;
    if (availablePaths.has(candidate)) return candidate;
  }
  return undefined;
}

function directory(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}
