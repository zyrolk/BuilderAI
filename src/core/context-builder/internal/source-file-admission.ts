import type { ContextOmission, ContextSourceFile } from '../types';

export function admitSourceFilesByMeasuredBudget(
  rankedFiles: readonly ContextSourceFile[],
  maxFiles: number,
  targetMaxCharacters: number,
  measure: (files: readonly ContextSourceFile[], omissions: readonly ContextOmission[]) => number,
): {
  readonly admitted: readonly ContextSourceFile[];
  readonly omissions: readonly ContextOmission[];
} {
  const admitted: ContextSourceFile[] = [];
  const omissions: ContextOmission[] = [];
  let fileLimitRecorded = false;

  for (const file of rankedFiles) {
    if (admitted.length >= maxFiles) {
      if (!fileLimitRecorded) {
        omissions.push({ kind: 'FILE', identifier: file.path, reason: 'FILE_LIMIT' });
        fileLimitRecorded = true;
      }
      break;
    }

    const trialSize = measure([...admitted, file], omissions);
    if (trialSize > targetMaxCharacters && admitted.length > 0) {
      omissions.push({ kind: 'FILE', identifier: file.path, reason: 'SIZE_LIMIT' });
      continue;
    }

    admitted.push(file);
  }

  while (admitted.length > 1 && measure(admitted, omissions) > targetMaxCharacters) {
    const removed = admitted.pop();
    if (removed === undefined) break;
    omissions.push({ kind: 'FILE', identifier: removed.path, reason: 'SIZE_LIMIT' });
  }

  return { admitted, omissions };
}
