/**
 * ADR-052 — workspace-relative path normalization for failure diagnostics.
 */

import path from 'node:path';

import {
  isSafeProjectPath,
  normalizeProjectPath,
} from '../../../core/context-builder/internal/path';
import type { WorkspacePathProtectionPolicy } from '../../../core/target-project/workspace-path-protection';
import { MAX_FAILURE_DIAGNOSTIC_PATH_LENGTH } from './failure-diagnostic.constants';

export function normalizeFailureDiagnosticRelativePath(input: {
  readonly rawPath: string;
  readonly projectRoot: string;
  readonly pathProtection?: WorkspacePathProtectionPolicy;
}): string | undefined {
  const trimmed = input.rawPath.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FAILURE_DIAGNOSTIC_PATH_LENGTH) {
    return undefined;
  }
  if (trimmed.includes('\0')) return undefined;
  if (isUncPath(trimmed)) return undefined;

  const resolvedRoot = path.resolve(input.projectRoot);
  let relative: string | undefined;

  if (path.isAbsolute(trimmed)) {
    const resolved = path.resolve(trimmed);
    if (!isPathWithinProject(resolved, resolvedRoot)) return undefined;
    relative = path.relative(resolvedRoot, resolved);
  } else {
    if (containsTraversal(trimmed)) return undefined;
    const resolved = path.resolve(resolvedRoot, trimmed);
    if (!isPathWithinProject(resolved, resolvedRoot)) return undefined;
    relative = path.relative(resolvedRoot, resolved);
  }

  const normalized = normalizeProjectPath(relative);
  if (normalized.length === 0 || normalized.length > MAX_FAILURE_DIAGNOSTIC_PATH_LENGTH) {
    return undefined;
  }
  if (!isSafeProjectPath(normalized)) return undefined;
  if (input.pathProtection?.isNeverExpose(normalized)) return undefined;
  return normalized;
}

function isUncPath(value: string): boolean {
  return value.startsWith('\\\\') || value.startsWith('//');
}

function containsTraversal(value: string): boolean {
  return value.split(/[\\/]/u).some((segment) => segment === '..');
}

function isPathWithinProject(candidate: string, projectRoot: string): boolean {
  if (pathsEqual(candidate, projectRoot)) return true;
  const relative = path.relative(projectRoot, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathsEqual(left: string, right: string): boolean {
  return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}
