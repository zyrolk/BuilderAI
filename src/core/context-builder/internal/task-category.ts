import { expandQueryTokens, normalizeText, tokenize } from './text-relevance';

export const TASK_CATEGORIES = ['DATABASE', 'API', 'AUTH_ADMIN', 'TESTS', 'UI'] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

const CATEGORY_KEYWORDS: Readonly<Record<TaskCategory, readonly string[]>> = {
  DATABASE: ['database', 'schema', 'migration', 'model', 'prisma', 'drizzle', 'sql'],
  API: ['api', 'endpoint', 'route', 'server'],
  AUTH_ADMIN: ['auth', 'admin', 'session', 'customer', 'permission', 'moderation', 'middleware'],
  TESTS: ['test', 'spec'],
  UI: ['component', 'page', 'form', 'ui', 'hook'],
};

const TEST_PRIMARY_PATTERNS = [
  /(?:write|add|create|fix|implement|cover|extend)\s+(?:the\s+)?(?:unit\s+|integration\s+)?tests/u,
  /(?:test coverage|testing strategy|test suite|tests for)/u,
  /^add tests/u,
] as const;

export function inferTaskCategories(taskCorpus: string): ReadonlySet<TaskCategory> {
  const tokens = expandQueryTokens(tokenize(taskCorpus));
  const categories = new Set<TaskCategory>();
  for (const category of TASK_CATEGORIES) {
    if (CATEGORY_KEYWORDS[category].some((keyword) => tokens.has(keyword))) {
      categories.add(category);
    }
  }
  return categories;
}

/** True when testing is the task focus, not an incidental "update tests as needed" mention. */
export function isTestPrimaryTask(
  taskCorpus: string,
  categories: ReadonlySet<TaskCategory>,
): boolean {
  if (!categories.has('TESTS')) return false;
  const normalized = normalizeText(taskCorpus);
  return TEST_PRIMARY_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function categoryKeywords(category: TaskCategory): readonly string[] {
  return CATEGORY_KEYWORDS[category];
}
