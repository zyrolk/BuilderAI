import { existsSync } from 'node:fs';
import path from 'node:path';

import { VerificationPolicyViolationError } from '../../core/verification/policy';

export interface NpmInvocation {
  readonly executable: string;
  readonly arguments: readonly string[];
}

/**
 * Resolve a shell-less npm invocation.
 *
 * On Windows, never returns *.cmd (spawn with shell:false yields EINVAL). Prefer
 * node.exe + adjacent npm-cli.js (execPath first, then PATH / known installs).
 */
export function resolveNpmInvocation(arguments_: readonly string[]): NpmInvocation {
  if (process.platform !== 'win32') {
    return { executable: 'npm', arguments: arguments_ };
  }

  const fromExecPath = tryNodeWithAdjacentNpm(process.execPath);
  if (fromExecPath !== undefined) {
    return {
      executable: fromExecPath.nodeExecutable,
      arguments: [fromExecPath.npmCliPath, ...arguments_],
    };
  }

  const fromSearch = findNodeWithAdjacentNpm();
  if (fromSearch !== undefined) {
    return {
      executable: fromSearch.nodeExecutable,
      arguments: [fromSearch.npmCliPath, ...arguments_],
    };
  }

  throw new VerificationPolicyViolationError(
    'NPM_INVOCATION_UNAVAILABLE',
    'Unable to resolve a Node.js executable with an adjacent npm-cli.js for shell-less Windows spawn. Refusing to spawn npm.cmd with shell:false.',
  );
}

function tryNodeWithAdjacentNpm(
  nodeExecutable: string,
): { readonly nodeExecutable: string; readonly npmCliPath: string } | undefined {
  if (!existsSync(nodeExecutable)) {
    return undefined;
  }
  const npmCliPath = path.resolve(path.dirname(nodeExecutable), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npmCliPath)) {
    return undefined;
  }
  return { nodeExecutable, npmCliPath };
}

function findNodeWithAdjacentNpm():
  { readonly nodeExecutable: string; readonly npmCliPath: string } | undefined {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string): void => {
    const resolved = path.resolve(candidate);
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(resolved);
  };

  const pathEnv = process.env.PATH ?? process.env.Path ?? '';
  for (const entry of pathEnv.split(path.delimiter)) {
    const trimmed = entry.trim().replace(/^"(.*)"$/, '$1');
    if (trimmed.length === 0) continue;
    addCandidate(path.join(trimmed, 'node.exe'));
  }

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  addCandidate(path.join(programFiles, 'nodejs', 'node.exe'));
  if (typeof programFilesX86 === 'string' && programFilesX86.length > 0) {
    addCandidate(path.join(programFilesX86, 'nodejs', 'node.exe'));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData === 'string' && localAppData.length > 0) {
    addCandidate(path.join(localAppData, 'Programs', 'nodejs', 'node.exe'));
  }

  for (const candidate of candidates) {
    const matched = tryNodeWithAdjacentNpm(candidate);
    if (matched !== undefined) {
      return matched;
    }
  }
  return undefined;
}
