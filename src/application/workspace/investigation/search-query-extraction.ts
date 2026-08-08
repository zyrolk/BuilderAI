const IDENTIFIER_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/gu;
const STACK_FILE_PATTERN = /(?:[\w./$-]+\/)?([\w./-]+\.(?:tsx?|jsx?|mjs|cjs))\b/giu;
const QUOTED_FRAGMENT_PATTERN = /'([^']{4,120})'|"([^"]{4,120})"/gu;
const CAMEL_CASE_FRAGMENT = /\b[a-z][a-zA-Z0-9]{3,}\b/gu;

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'and',
  'anything',
  'are',
  'authority',
  'because',
  'before',
  'being',
  'between',
  'cannot',
  'change',
  'comparisons',
  'correctly',
  'could',
  'coverage',
  'current',
  'during',
  'enabled',
  'error',
  'files',
  'first',
  'found',
  'from',
  'have',
  'help',
  'here',
  'investigate',
  'issue',
  'just',
  'like',
  'make',
  'need',
  'only',
  'order',
  'please',
  'problem',
  'root',
  'should',
  'some',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'through',
  'under',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'without',
  'would',
  'your',
]);

function normalizeQuery(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return undefined;
  return trimmed;
}

function addQuery(queries: Set<string>, candidate: string | undefined): void {
  if (candidate === undefined) return;
  const normalized = normalizeQuery(candidate);
  if (normalized === undefined) return;
  queries.add(normalized);
}

function addIdentifierQueries(queries: Set<string>, text: string): void {
  for (const match of text.matchAll(IDENTIFIER_PATTERN)) {
    const token = match[0]!;
    if (STOP_WORDS.has(token.toLowerCase())) continue;
    if (/^[A-Z_]+$/.test(token) && token.length < 5) continue;
    addQuery(queries, token);
  }
  for (const match of text.matchAll(CAMEL_CASE_FRAGMENT)) {
    const token = match[0]!;
    if (STOP_WORDS.has(token.toLowerCase())) continue;
    addQuery(queries, token);
  }
}

export function extractSearchQueries(request: string, maximumQueries: number): readonly string[] {
  const queries = new Set<string>();

  for (const match of request.matchAll(QUOTED_FRAGMENT_PATTERN)) {
    addQuery(queries, match[1] ?? match[2]);
  }

  for (const match of request.matchAll(STACK_FILE_PATTERN)) {
    addQuery(queries, match[1]);
    const basename = match[1]?.split('/').at(-1);
    if (basename !== undefined) addQuery(queries, basename.replace(/\.[^.]+$/u, ''));
  }

  const errorLine = request
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /(?:error|exception|failed|undefined|cannot read)/iu.test(line));
  if (errorLine !== undefined) {
    addIdentifierQueries(queries, errorLine);
    const propertyMatch = /reading '([^']+)'/iu.exec(errorLine);
    if (propertyMatch?.[1] !== undefined) addQuery(queries, propertyMatch[1]);
  }

  addIdentifierQueries(queries, request);

  return [...queries]
    .sort((left, right) => left.localeCompare(right) || left.length - right.length)
    .slice(0, maximumQueries);
}
