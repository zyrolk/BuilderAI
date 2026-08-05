import type { ContextOmission, ContextSourceFile } from '../types';
import { sourcePathCategory, type TaskCategory } from '../internal/task-category';

const TEST_FILE_PATTERN = /\.(spec|test)\.(cjs|js|jsx|mjs|ts|tsx)$/u;

export type SourceFileAdmissionBucket = 'implementation' | 'tests' | 'config';

export function classifySourceFileAdmissionBucket(path: string): SourceFileAdmissionBucket {
  if (path === 'package.json' || /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/u.test(path)) {
    return 'config';
  }
  if (TEST_FILE_PATTERN.test(path) || path.includes('/__tests__/')) return 'tests';
  return 'implementation';
}

export function admitSourceFilesByMeasuredBudget(
  rankedFiles: readonly ContextSourceFile[],
  maxFiles: number,
  targetMaxCharacters: number,
  measure: (files: readonly ContextSourceFile[], omissions: readonly ContextOmission[]) => number,
  quotas: Readonly<Record<SourceFileAdmissionBucket, number>> = {
    implementation: maxFiles,
    tests: maxFiles,
    config: maxFiles,
  },
): {
  readonly admitted: readonly ContextSourceFile[];
  readonly omissions: readonly ContextOmission[];
} {
  const admitted: ContextSourceFile[] = [];
  const omissions: ContextOmission[] = [];
  const bucketCounts: Record<SourceFileAdmissionBucket, number> = {
    implementation: 0,
    tests: 0,
    config: 0,
  };
  let fileLimitRecorded = false;

  for (const file of rankedFiles) {
    if (admitted.length >= maxFiles) {
      if (!fileLimitRecorded) {
        omissions.push({ kind: 'FILE', identifier: file.path, reason: 'FILE_LIMIT' });
        fileLimitRecorded = true;
      }
      break;
    }

    const bucket = classifySourceFileAdmissionBucket(file.path);
    if (bucketCounts[bucket] >= quotas[bucket]) {
      omissions.push({ kind: 'FILE', identifier: file.path, reason: 'FILE_LIMIT' });
      continue;
    }

    const trialSize = measure([...admitted, file], omissions);
    if (trialSize > targetMaxCharacters && admitted.length > 0) {
      omissions.push({ kind: 'FILE', identifier: file.path, reason: 'SIZE_LIMIT' });
      continue;
    }

    admitted.push(file);
    bucketCounts[bucket] += 1;
  }

  while (admitted.length > 1 && measure(admitted, omissions) > targetMaxCharacters) {
    const removed = admitted.pop();
    if (removed === undefined) break;
    omissions.push({ kind: 'FILE', identifier: removed.path, reason: 'SIZE_LIMIT' });
  }

  return { admitted, omissions };
}

export function categoryEvidenceForPath(path: string): TaskCategory | undefined {
  return sourcePathCategory(path);
}
