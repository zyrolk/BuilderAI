import {
  basenameStemForPath,
  isTestCounterpart,
} from '../../../core/context-builder/internal/path-relevance';
import type { ProjectChangePlan } from '../../../core/change-planner';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import type { CorrectionDiagnostic } from './correction-loop.types';

const MAX_EXPANDED_PATHS = 24 as const;

export interface CorrectionScopeValidationInput {
  readonly diagnostic: CorrectionDiagnostic;
  readonly changePlan: ProjectChangePlan;
  readonly investigationEvidencePaths?: readonly string[];
  readonly explicitlyAuthorizedPaths?: readonly string[];
}

export type CorrectionScopeValidationResult =
  | { readonly ok: true; readonly allowedPaths: readonly string[] }
  | {
      readonly ok: false;
      readonly code: 'CORRECTION_SCOPE_VIOLATION';
      readonly rejectedPaths: readonly string[];
      readonly message: string;
    };

export function validateCorrectionChangePlanScope(
  input: CorrectionScopeValidationInput,
): CorrectionScopeValidationResult {
  const allowed = buildCorrectionAllowedPaths(input);
  const rejected: string[] = [];

  for (const operation of input.changePlan.changeSet.operations) {
    const path = operation.logicalPath;
    if (!isScopeEligiblePath(path)) {
      rejected.push(path);
      continue;
    }
    if (!allowed.has(path)) {
      rejected.push(path);
    }
  }

  if (rejected.length > 0) {
    return {
      ok: false,
      code: 'CORRECTION_SCOPE_VIOLATION',
      rejectedPaths: uniqueSorted(rejected),
      message: `Correction ChangePlan modifies paths outside supported evidence scope: ${uniqueSorted(rejected).join(', ')}.`,
    };
  }

  return { ok: true, allowedPaths: uniqueSorted([...allowed]) };
}

export function buildCorrectionAllowedPaths(input: CorrectionScopeValidationInput): Set<string> {
  const allowed = new Set<string>();

  for (const path of input.diagnostic.affectedFiles) {
    if (isSafeRelativePath(path)) allowed.add(normalizePath(path));
  }
  for (const path of input.investigationEvidencePaths ?? []) {
    if (isSafeRelativePath(path)) allowed.add(normalizePath(path));
  }
  for (const path of input.explicitlyAuthorizedPaths ?? []) {
    if (isSafeRelativePath(path)) allowed.add(normalizePath(path));
  }
  for (const evidence of input.diagnostic.diagnostics) {
    if (evidence.path !== undefined && isSafeRelativePath(evidence.path)) {
      allowed.add(normalizePath(evidence.path));
    }
  }

  const anchors = [...allowed];
  for (const anchor of anchors) {
    expandEvidenceRelatedPaths(anchor, allowed);
    if (allowed.size >= MAX_EXPANDED_PATHS) break;
  }

  return allowed;
}

function expandEvidenceRelatedPaths(anchor: string, allowed: Set<string>): void {
  const stem = basenameStemForPath(anchor);
  if (stem.length === 0) return;

  const directory = directoryOf(anchor);
  const candidates = [
    anchor,
    `${directory}/${stem}.ts`,
    `${directory}/${stem}.tsx`,
    `${directory}/${stem}.js`,
    `${directory}/${stem}.jsx`,
    `src/${stem}.ts`,
    `src/${stem}.tsx`,
    `tests/${stem}.test.ts`,
    `tests/${stem}.spec.ts`,
    `src/${stem}.test.ts`,
    `src/${stem}.spec.ts`,
  ];

  for (const candidate of candidates) {
    if (!isSafeRelativePath(candidate)) continue;
    const normalized = normalizePath(candidate);
    if (isTestCounterpart(normalized, stem) || normalized === anchor) {
      allowed.add(normalized);
    }
    if (normalized.startsWith(`${directory}/`) && basenameStemForPath(normalized) === stem) {
      allowed.add(normalized);
    }
    if (allowed.size >= MAX_EXPANDED_PATHS) return;
  }
}

function directoryOf(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '').trim();
}

function isSafeRelativePath(value: string): boolean {
  const normalized = normalizePath(value);
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[a-z]:\//i.test(normalized) &&
    !normalized.split('/').includes('..')
  );
}

function uniqueSorted(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}
