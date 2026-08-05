import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Deterministic npm script name resolution for external-target verification (ADR-035).
 * Only explicitly declared package.json script keys are used — never inferred shell commands.
 */
export const LINT_SCRIPT_CANDIDATES = ['lint'] as const;
export const TYPECHECK_SCRIPT_CANDIDATES = ['typecheck', 'type-check'] as const;

export interface DiscoveredPackageScripts {
  readonly hasBuild: boolean;
  readonly hasTest: boolean;
  readonly lintScript: string | undefined;
  readonly typecheckScript: string | undefined;
}

export function discoverPackageScripts(projectRoot: string): DiscoveredPackageScripts {
  const packagePath = path.join(path.resolve(projectRoot), 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown;
  } catch {
    return { hasBuild: false, hasTest: false, lintScript: undefined, typecheckScript: undefined };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { hasBuild: false, hasTest: false, lintScript: undefined, typecheckScript: undefined };
  }
  const scripts = Reflect.get(parsed, 'scripts');
  if (typeof scripts !== 'object' || scripts === null) {
    return { hasBuild: false, hasTest: false, lintScript: undefined, typecheckScript: undefined };
  }
  const names = new Set(
    Object.keys(scripts).filter((name) => typeof Reflect.get(scripts, name) === 'string'),
  );
  return {
    hasBuild: names.has('build'),
    hasTest: names.has('test'),
    lintScript: resolveFirstCandidate(names, LINT_SCRIPT_CANDIDATES),
    typecheckScript: resolveFirstCandidate(names, TYPECHECK_SCRIPT_CANDIDATES),
  };
}

function resolveFirstCandidate(
  names: ReadonlySet<string>,
  candidates: readonly string[],
): string | undefined {
  return candidates.find((candidate) => names.has(candidate));
}
