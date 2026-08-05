import { CONTEXT_RETRIEVAL_SCORING } from '../config/context-retrieval-policy';
import { isSafeProjectPath, normalizeProjectPath } from './path';
import type { TaskCategory } from './task-category';
import {
  categoryKeywords,
  isTestPrimaryTask,
  sourcePathCategory,
  TASK_CATEGORIES,
} from './task-category';
import { normalizeText, tokenize, tokenOverlapCount } from './text-relevance';

const ROLE_SEGMENTS: Readonly<Record<TaskCategory, readonly string[]>> = {
  DATABASE: ['prisma', 'drizzle', 'migrations', 'migration', 'schema', 'models', 'repositories'],
  API: ['api', 'routes', 'route', 'controllers', 'server', 'backend', 'services', 'validation'],
  AUTH_ADMIN: ['auth', 'admin', 'session', 'middleware'],
  SHARED: ['shared', 'common', 'types', 'contracts', 'lib'],
  TESTS: ['tests', 'test', '__tests__'],
  UI: ['components', 'component', 'pages', 'page', 'hooks', 'hook', 'ui', 'features', 'client'],
};

const TEST_FILE_PATTERN = /\.(spec|test)\.(cjs|js|jsx|mjs|ts|tsx)$/u;
const SCHEMA_FILE_PATTERN = /(?:^|\/)schema\.prisma$/u;

export interface RankedCandidatePath {
  readonly path: string;
  readonly pathScore: number;
}

function pathSegments(sourcePath: string): readonly string[] {
  return sourcePath.split('/').filter((segment) => segment.length > 0);
}

function basename(sourcePath: string): string {
  const segments = pathSegments(sourcePath);
  return segments.at(-1) ?? sourcePath;
}

function basenameStem(sourcePath: string): string {
  const name = basename(sourcePath);
  const dotIndex = name.lastIndexOf('.');
  return dotIndex <= 0 ? name : name.slice(0, dotIndex);
}

function pathSegmentScore(queryVariants: ReadonlySet<string>, sourcePath: string): number {
  let matches = 0;
  for (const segment of pathSegments(sourcePath)) {
    const segmentTokens = tokenize(segment);
    if (tokenOverlapCount(queryVariants, segmentTokens) > 0) matches += 1;
  }
  return matches * CONTEXT_RETRIEVAL_SCORING.PATH_SEGMENT;
}

function filenameScore(queryVariants: ReadonlySet<string>, sourcePath: string): number {
  const stemTokens = tokenize(basenameStem(sourcePath));
  const overlap = tokenOverlapCount(queryVariants, stemTokens);
  return overlap > 0 ? CONTEXT_RETRIEVAL_SCORING.FILENAME : 0;
}

function roleHintScore(categories: ReadonlySet<TaskCategory>, sourcePath: string): number {
  if (categories.size === 0) return 0;
  const normalizedPath = normalizeText(sourcePath.replaceAll('/', ' '));
  let score = 0;
  for (const category of categories) {
    for (const segment of ROLE_SEGMENTS[category]) {
      if (normalizedPath.includes(segment)) {
        score += CONTEXT_RETRIEVAL_SCORING.ROLE_HINT;
        break;
      }
    }
  }
  return score;
}

function specialFileBoost(
  categories: ReadonlySet<TaskCategory>,
  sourcePath: string,
  taskCorpus: string,
): number {
  let score = 0;
  const name = basename(sourcePath);
  if (
    categories.has('DATABASE') &&
    (SCHEMA_FILE_PATTERN.test(sourcePath) ||
      sourcePath.includes('/drizzle/') ||
      (sourcePath.includes('/migrations/') && sourcePath.endsWith('.sql')))
  ) {
    score += CONTEXT_RETRIEVAL_SCORING.SPECIAL_SCHEMA;
  }
  if (
    isTestPrimaryTask(taskCorpus, categories) &&
    (TEST_FILE_PATTERN.test(sourcePath) || sourcePath.includes('/__tests__/'))
  ) {
    score += CONTEXT_RETRIEVAL_SCORING.SPECIAL_TEST;
  }
  if (categories.has('API') || categories.has('TESTS') || categories.has('DATABASE')) {
    if (name === 'package.json') score += CONTEXT_RETRIEVAL_SCORING.SPECIAL_PACKAGE;
  }
  return score;
}

function moduleBoost(sourcePath: string, scoredModulePaths: ReadonlySet<string>): number {
  for (const modulePath of scoredModulePaths) {
    if (sourcePath === modulePath || sourcePath.startsWith(`${modulePath}/`)) {
      return CONTEXT_RETRIEVAL_SCORING.MODULE_BOOST;
    }
  }
  return 0;
}

function normalizeHintPath(value: string): string {
  return normalizeProjectPath(value).replace(/\/$/, '');
}

/** Matches exact file hints and directory hints with POSIX segment boundaries (ADR-024). */
export function matchesIterationPathHint(sourcePath: string, hint: string): boolean {
  const normalizedSource = normalizeHintPath(sourcePath);
  const normalizedHint = normalizeHintPath(hint);
  if (normalizedSource.length === 0 || normalizedHint.length === 0) return false;
  if (!isSafeProjectPath(normalizedSource) || !isSafeProjectPath(normalizedHint)) return false;
  if (normalizedSource === normalizedHint) return true;
  return normalizedSource.startsWith(`${normalizedHint}/`);
}

function iterationHintBoost(
  sourcePath: string,
  iterationPathHints: ReadonlySet<string>,
  baseScore: number,
): number {
  if (baseScore < 1 || iterationPathHints.size === 0) return 0;
  for (const hint of iterationPathHints) {
    if (matchesIterationPathHint(sourcePath, hint)) {
      return CONTEXT_RETRIEVAL_SCORING.ITERATION_PATH_HINT_BOOST;
    }
  }
  return 0;
}

function explicitPathHintBoost(sourcePath: string, explicitPathHints: ReadonlySet<string>): number {
  if (explicitPathHints.size === 0) return 0;
  for (const hint of explicitPathHints) {
    if (normalizeHintPath(sourcePath) === normalizeHintPath(hint)) {
      return CONTEXT_RETRIEVAL_SCORING.EXPLICIT_PATH_BOOST;
    }
  }
  return 0;
}

function domainDirectoryBoost(queryVariants: ReadonlySet<string>, sourcePath: string): number {
  for (const segment of pathSegments(sourcePath)) {
    const segmentTokens = tokenize(segment);
    if (tokenOverlapCount(queryVariants, segmentTokens) >= 2) {
      return CONTEXT_RETRIEVAL_SCORING.DOMAIN_DIRECTORY;
    }
  }
  return 0;
}

function basenameAffinityBoost(queryVariants: ReadonlySet<string>, sourcePath: string): number {
  const stemTokens = tokenize(basenameStem(sourcePath));
  return tokenOverlapCount(queryVariants, stemTokens) >= 2
    ? CONTEXT_RETRIEVAL_SCORING.BASENAME_AFFINITY
    : 0;
}

export function scoreCandidatePath(
  sourcePath: string,
  queryVariants: ReadonlySet<string>,
  categories: ReadonlySet<TaskCategory>,
  scoredModulePaths: ReadonlySet<string>,
  taskCorpus: string,
  iterationPathHints: ReadonlySet<string> = new Set(),
  explicitPathHints: ReadonlySet<string> = new Set(),
): number {
  if (!isTestPrimaryTask(taskCorpus, categories) && sourcePath.includes('.fixture.')) {
    return 0;
  }
  if (categories.has('API') && !categories.has('UI')) {
    const pathCategory = sourcePathCategory(sourcePath);
    if (pathCategory === 'UI') return 0;
  }
  if (categories.has('UI') && !categories.has('API')) {
    const pathCategory = sourcePathCategory(sourcePath);
    if (pathCategory === 'API') return 0;
  }
  const pathTokens = tokenize(sourcePath.replaceAll('/', ' '));
  const baseScore =
    tokenOverlapCount(queryVariants, pathTokens) * CONTEXT_RETRIEVAL_SCORING.TOKEN_OVERLAP +
    pathSegmentScore(queryVariants, sourcePath) +
    filenameScore(queryVariants, sourcePath) +
    roleHintScore(categories, sourcePath) +
    specialFileBoost(categories, sourcePath, taskCorpus) +
    domainDirectoryBoost(queryVariants, sourcePath) +
    testAffinityBoost(sourcePath, collectAnchorStems(queryVariants)) +
    basenameAffinityBoost(queryVariants, sourcePath);
  const eligibleBase =
    baseScore + (baseScore >= 1 ? moduleBoost(sourcePath, scoredModulePaths) : 0);
  return (
    eligibleBase +
    explicitPathHintBoost(sourcePath, explicitPathHints) +
    iterationHintBoost(sourcePath, iterationPathHints, baseScore)
  );
}

export function compareCandidatePaths(
  left: RankedCandidatePath,
  right: RankedCandidatePath,
): number {
  return (
    right.pathScore - left.pathScore ||
    left.path.length - right.path.length ||
    left.path.localeCompare(right.path)
  );
}

export function rankCandidatePaths(
  sourcePaths: readonly string[],
  queryVariants: ReadonlySet<string>,
  categories: ReadonlySet<TaskCategory>,
  scoredModulePaths: ReadonlySet<string>,
  taskCorpus: string,
  iterationPathHints: ReadonlySet<string> = new Set(),
  explicitPathHints: ReadonlySet<string> = new Set(),
): readonly RankedCandidatePath[] {
  return sourcePaths
    .map((path) => ({
      path,
      pathScore: scoreCandidatePath(
        path,
        queryVariants,
        categories,
        scoredModulePaths,
        taskCorpus,
        iterationPathHints,
        explicitPathHints,
      ),
    }))
    .sort(compareCandidatePaths);
}

function matchesCategoryFloor(path: string, category: TaskCategory): boolean {
  const normalized = normalizeText(path.replaceAll('/', ' '));
  switch (category) {
    case 'DATABASE':
      return (
        SCHEMA_FILE_PATTERN.test(path) ||
        normalized.includes('drizzle') ||
        normalized.includes('migration') ||
        normalized.includes('schema')
      );
    case 'AUTH_ADMIN':
      return ['auth', 'admin', 'session', 'middleware'].some((segment) =>
        normalized.includes(segment),
      );
    case 'TESTS':
      return (
        TEST_FILE_PATTERN.test(path) || path.includes('/__tests__/') || path.includes('/tests/')
      );
    case 'API':
      return (
        (normalized.includes('api') &&
          (normalized.includes('route') || normalized.includes('routes'))) ||
        (normalized.includes('server') &&
          (normalized.includes('routes') ||
            normalized.includes('services') ||
            normalized.includes('validation')))
      );
    case 'SHARED':
      return (
        normalized.includes('shared') ||
        normalized.includes('common') ||
        normalized.includes('types') ||
        normalized.includes('contracts')
      );
    default:
      return categoryKeywords(category).some((keyword) => normalized.includes(keyword));
  }
}

export function buildReadShortlist(
  rankedPaths: readonly RankedCandidatePath[],
  categories: ReadonlySet<TaskCategory>,
  maxReads: number,
  taskCorpus: string,
): readonly string[] {
  const shortlist = rankedPaths.slice(0, maxReads).map(({ path }) => path);
  const shortlistSet = new Set(shortlist);

  for (const category of TASK_CATEGORIES) {
    if (!categories.has(category)) continue;
    if (category === 'TESTS' && !isTestPrimaryTask(taskCorpus, categories)) continue;
    const floorCandidate = rankedPaths.find(({ path }) => matchesCategoryFloor(path, category));
    if (floorCandidate === undefined || shortlistSet.has(floorCandidate.path)) continue;

    const replaceIndex = shortlist.length - 1;
    const replaced = shortlist[replaceIndex];
    if (replaced === undefined) continue;
    shortlistSet.delete(replaced);
    shortlist[replaceIndex] = floorCandidate.path;
    shortlistSet.add(floorCandidate.path);
  }

  return shortlist;
}

export function isTestCounterpart(sourcePath: string, anchorStem: string): boolean {
  if (!TEST_FILE_PATTERN.test(sourcePath)) return false;
  const stem = basenameStem(sourcePath).replace(/\.(spec|test)$/u, '');
  return (
    stem === anchorStem || stem.startsWith(`${anchorStem}.`) || anchorStem.startsWith(`${stem}.`)
  );
}

export function testAffinityBoost(sourcePath: string, anchorStems: ReadonlySet<string>): number {
  if (anchorStems.size === 0) return 0;
  for (const anchor of anchorStems) {
    if (isTestCounterpart(sourcePath, anchor)) {
      return CONTEXT_RETRIEVAL_SCORING.TEST_FILENAME_AFFINITY;
    }
  }
  return 0;
}

export function basenameStemForPath(sourcePath: string): string {
  return basenameStem(sourcePath);
}

function collectAnchorStems(queryVariants: ReadonlySet<string>): ReadonlySet<string> {
  return new Set([...queryVariants].filter((token) => token.length >= 4));
}
