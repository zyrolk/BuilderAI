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

export function relevanceScore(query: ReadonlySet<string>, candidate: string): number {
  const candidateTokens = tokenize(candidate);
  let score = 0;
  for (const token of query) if (candidateTokens.has(token)) score += 1;
  return score;
}

export function contentFingerprint(value: string): string {
  return normalizeText(value);
}
