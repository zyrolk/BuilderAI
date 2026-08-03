import { CONTEXT_RETRIEVAL_SCORING } from '../config/context-retrieval-policy';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
]);

export function normalizeText(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function tokenize(value: string): ReadonlySet<string> {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function singularVariants(token: string): readonly string[] {
  const variants: string[] = [token];
  if (token.endsWith('ies') && token.length > 4) variants.push(`${token.slice(0, -3)}y`);
  if (token.endsWith('s') && token.length > 4 && !token.endsWith('ss')) {
    variants.push(token.slice(0, -1));
  }
  if (token.endsWith('ed') && token.length > 4) variants.push(token.slice(0, -1));
  return variants;
}

export function expandQueryTokens(tokens: ReadonlySet<string>): ReadonlySet<string> {
  const expanded = new Set<string>();
  for (const token of tokens) {
    for (const variant of singularVariants(token)) expanded.add(variant);
  }
  return expanded;
}

export function tokenOverlapCount(
  queryVariants: ReadonlySet<string>,
  candidateTokens: ReadonlySet<string>,
): number {
  let score = 0;
  for (const token of queryVariants) if (candidateTokens.has(token)) score += 1;
  return score;
}

export function relevanceScore(query: ReadonlySet<string>, candidate: string): number {
  return tokenOverlapCount(query, tokenize(candidate));
}

export function boundedContentScore(
  queryVariants: ReadonlySet<string>,
  content: string,
  overlapWeight: number,
  cap: number,
): number {
  const overlap = tokenOverlapCount(queryVariants, tokenize(content));
  return Math.min(overlap * overlapWeight, cap);
}

export function effectiveAdmissionScore(combinedScore: number, characterLength: number): number {
  const baseFactor = 1 + Math.log10(Math.max(characterLength, 1));
  const largeFilePenalty =
    characterLength > CONTEXT_RETRIEVAL_SCORING.LARGE_FILE_CHARACTER_THRESHOLD
      ? Math.log10(characterLength / CONTEXT_RETRIEVAL_SCORING.LARGE_FILE_CHARACTER_THRESHOLD) *
        CONTEXT_RETRIEVAL_SCORING.LARGE_FILE_EXTRA_LOG_DIVISOR
      : 0;
  return combinedScore / (baseFactor + largeFilePenalty);
}

export function contentFingerprint(value: string): string {
  return normalizeText(value);
}
