import { normalizeProjectPath } from './path';
import { buildPartialSourceExcerpt } from './partial-source-content';
import type { ContextSourceFile, SourceContextPolicy } from '../types';

function normalizePath(path: string): string {
  return normalizeProjectPath(path);
}

export function applySourceContextPresentation(
  files: readonly ContextSourceFile[],
  policy: SourceContextPolicy | undefined,
): readonly ContextSourceFile[] {
  if (policy === undefined) return files;
  const protectedPaths = new Set(policy.protectedPaths.map(normalizePath));
  const fullContentPaths = new Set(policy.fullContentPaths.map(normalizePath));

  return files.map((file) => {
    const normalizedPath = normalizePath(file.path);
    const protectedFromEviction = protectedPaths.has(normalizedPath);
    if (fullContentPaths.has(normalizedPath)) {
      return {
        ...file,
        protectedFromEviction,
        contentPresentation: 'FULL' as const,
      };
    }
    const partial = buildPartialSourceExcerpt(file.content, policy.partialContentCharacterLimit);
    return {
      ...file,
      content: partial.content,
      protectedFromEviction,
      contentPresentation: 'PARTIAL_EXCERPT' as const,
    };
  });
}

export function markProtectedSourceFiles(
  files: readonly ContextSourceFile[],
  protectedPaths: readonly string[],
): readonly ContextSourceFile[] {
  if (protectedPaths.length === 0) return files;
  const protectedSet = new Set(protectedPaths.map(normalizePath));
  return files.map((file) =>
    protectedSet.has(normalizePath(file.path)) ? { ...file, protectedFromEviction: true } : file,
  );
}
