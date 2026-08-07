import { expandQueryTokens, normalizeText, tokenize } from './text-relevance';

export const TASK_CATEGORIES = ['DATABASE', 'API', 'AUTH_ADMIN', 'SHARED', 'TESTS', 'UI'] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

const CATEGORY_KEYWORDS: Readonly<Record<TaskCategory, readonly string[]>> = {
  DATABASE: [
    'database',
    'schema',
    'migration',
    'model',
    'prisma',
    'drizzle',
    'sql',
    'firebase',
    'firestore',
  ],
  API: ['api', 'endpoint', 'route', 'server', 'backend', 'service', 'controller'],
  AUTH_ADMIN: ['auth', 'admin', 'session', 'customer', 'permission', 'moderation', 'middleware'],
  SHARED: ['shared', 'common', 'types', 'contract', 'contracts', 'util', 'utils'],
  TESTS: ['test', 'spec'],
  UI: ['component', 'page', 'form', 'ui', 'hook', 'frontend', 'react', 'dialog'],
};

const CROSS_STACK_DOMAIN_KEYWORDS = [
  'supplier',
  'order',
  'checkout',
  'storefront',
  'cancellation',
  'cancel',
  'hub',
] as const;

const TEST_PRIMARY_PATTERNS = [
  /(?:write|add|create|fix|implement|cover|extend)\s+(?:the\s+)?(?:unit\s+|integration\s+)?tests/u,
  /(?:test coverage|testing strategy|test suite|tests for)/u,
  /^add tests/u,
  /fix failing .* tests/u,
] as const;

const BACKEND_FOCUS_KEYWORDS = [
  'backend',
  'server',
  'express',
  'route',
  'controller',
  'endpoint',
  'validation',
] as const;

const FRONTEND_FOCUS_KEYWORDS = [
  'react',
  'frontend',
  'component',
  'page',
  'dialog',
  'ui',
  'jsx',
  'tsx',
] as const;

function hasKeyword(tokens: ReadonlySet<string>, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => tokens.has(keyword));
}

export function inferTaskCategories(taskCorpus: string): ReadonlySet<TaskCategory> {
  const tokens = expandQueryTokens(tokenize(taskCorpus));
  const categories = new Set<TaskCategory>();
  for (const category of TASK_CATEGORIES) {
    if (CATEGORY_KEYWORDS[category].some((keyword) => tokens.has(keyword))) {
      categories.add(category);
    }
  }
  if (CROSS_STACK_DOMAIN_KEYWORDS.some((keyword) => tokens.has(keyword))) {
    const backendFocused = hasKeyword(tokens, BACKEND_FOCUS_KEYWORDS);
    const frontendFocused = hasKeyword(tokens, FRONTEND_FOCUS_KEYWORDS);
    if (!backendFocused || frontendFocused) categories.add('UI');
    if (!frontendFocused || backendFocused) categories.add('API');
    categories.add('SHARED');
    if (tokens.has('test') || tokens.has('spec') || /tests?/u.test(normalizeText(taskCorpus))) {
      categories.add('TESTS');
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

export function sourcePathCategory(sourcePath: string): TaskCategory | undefined {
  const normalized = normalizeText(sourcePath.replaceAll('/', ' '));
  if (
    normalized.includes('shared') ||
    normalized.includes('common') ||
    normalized.includes('types') ||
    normalized.includes('contracts')
  ) {
    return 'SHARED';
  }
  if (
    TEST_FILE_PATTERN.test(sourcePath) ||
    normalized.includes('__tests__') ||
    normalized.includes('/tests/') ||
    normalized.includes('/test/')
  ) {
    return 'TESTS';
  }
  if (
    normalized.includes('server') ||
    normalized.includes('backend') ||
    normalized.includes('routes') ||
    normalized.includes('services') ||
    normalized.includes('validation')
  ) {
    return 'API';
  }
  if (
    normalized.includes('components') ||
    normalized.includes('features') ||
    normalized.includes('pages') ||
    normalized.includes('hooks') ||
    normalized.includes('client')
  ) {
    return 'UI';
  }
  if (
    normalized.includes('prisma') ||
    normalized.includes('drizzle') ||
    normalized.includes('schema') ||
    normalized.includes('firebase') ||
    normalized.includes('firestore')
  ) {
    return 'DATABASE';
  }
  return undefined;
}

const TEST_FILE_PATTERN = /\.(spec|test)\.(cjs|js|jsx|mjs|ts|tsx)$/u;
