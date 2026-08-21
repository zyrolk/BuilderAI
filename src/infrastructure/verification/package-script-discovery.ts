import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  FORMAT_SCRIPT_CANDIDATES,
  LINT_SCRIPT_CANDIDATES,
  TYPECHECK_SCRIPT_CANDIDATES,
} from '../../core/verification/policy/verification-script-candidates';

/**
 * Deterministic npm script name resolution for external-target verification (ADR-035).
 * Only explicitly declared package.json script keys are used — never inferred shell commands.
 */
export { LINT_SCRIPT_CANDIDATES, TYPECHECK_SCRIPT_CANDIDATES, FORMAT_SCRIPT_CANDIDATES };

export interface DiscoveredPackageScripts {
  readonly hasBuild: boolean;
  readonly hasTest: boolean;
  readonly lintScript: string | undefined;
  readonly typecheckScript: string | undefined;
  readonly formatScript: string | undefined;
}

export function discoverPackageScripts(projectRoot: string): DiscoveredPackageScripts {
  const packagePath = path.join(path.resolve(projectRoot), 'package.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown;
  } catch {
    return emptyDiscoveredScripts();
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return emptyDiscoveredScripts();
  }
  const scripts = Reflect.get(parsed, 'scripts');
  if (typeof scripts !== 'object' || scripts === null) {
    return emptyDiscoveredScripts();
  }
  const names = new Set(
    Object.keys(scripts).filter((name) => typeof Reflect.get(scripts, name) === 'string'),
  );
  return {
    hasBuild: names.has('build'),
    hasTest: names.has('test'),
    lintScript: resolveFirstCandidate(names, LINT_SCRIPT_CANDIDATES),
    typecheckScript: resolveFirstCandidate(names, TYPECHECK_SCRIPT_CANDIDATES),
    formatScript: resolveFirstCandidate(names, FORMAT_SCRIPT_CANDIDATES),
  };
}

function emptyDiscoveredScripts(): DiscoveredPackageScripts {
  return {
    hasBuild: false,
    hasTest: false,
    lintScript: undefined,
    typecheckScript: undefined,
    formatScript: undefined,
  };
}

function resolveFirstCandidate(
  names: ReadonlySet<string>,
  candidates: readonly string[],
): string | undefined {
  return candidates.find((candidate) => names.has(candidate));
}
