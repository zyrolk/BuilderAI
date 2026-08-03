import { CONTEXT_RETRIEVAL_SCORING } from '../config/context-retrieval-policy';
import { expandQueryTokens, tokenize } from './text-relevance';
import { inferTaskCategories, isTestPrimaryTask } from './task-category';
import { matchesIterationPathHint, rankCandidatePaths, scoreCandidatePath } from './path-relevance';

describe('text relevance query expansion', () => {
  it('normalizes plural and past-tense task tokens', () => {
    const variants = expandQueryTokens(tokenize('Moderation for admins who purchased products'));
    expect(variants.has('admin')).toBe(true);
    expect(variants.has('purchase')).toBe(true);
  });
});

describe('task category inference', () => {
  it('infers generic categories from task vocabulary', () => {
    expect(
      inferTaskCategories('Add database schema migration with API endpoints and tests'),
    ).toEqual(new Set(['DATABASE', 'API', 'TESTS']));
  });

  it('treats incidental test mentions as non-primary testing tasks', () => {
    const corpus =
      'Update context builder and prompt orchestrator tests as needed while preserving contracts.';
    const categories = inferTaskCategories(corpus);
    expect(categories.has('TESTS')).toBe(true);
    expect(isTestPrimaryTask(corpus, categories)).toBe(false);
  });

  it('detects test-primary tasks from explicit testing intent', () => {
    const corpus = 'Add tests for the checkout payment service and raise coverage.';
    const categories = inferTaskCategories(corpus);
    expect(isTestPrimaryTask(corpus, categories)).toBe(true);
  });
});

describe('path relevance ranking', () => {
  it('ranks schema and auth paths above unrelated marketing files', () => {
    const query = expandQueryTokens(
      tokenize(
        'Add product reviews with database changes, admin moderation, API endpoints, and tests.',
      ),
    );
    const categories = inferTaskCategories(
      'Add product reviews with database changes, admin moderation, API endpoints, and tests.',
    );
    const ranked = rankCandidatePaths(
      [
        'src/features/marketing/campaign.ts',
        'src/lib/auth.ts',
        'prisma/schema.prisma',
        'src/app/api/products/route.ts',
      ],
      query,
      categories,
      new Set(),
      'Add product reviews with database changes, admin moderation, API endpoints, and tests.',
    );
    expect(ranked[0]?.path).toBe('prisma/schema.prisma');
    expect(ranked.some(({ path }) => path === 'src/lib/auth.ts')).toBe(true);
    expect(ranked.at(-1)?.path).toBe('src/features/marketing/campaign.ts');
  });
});

describe('iteration path hint matching', () => {
  const workspaceFile = 'src/application/workspace/activity-history.service.ts';
  const nestedFile = 'src/application/workspace/nested/history.util.ts';
  const siblingPrefixFile = 'src/application/workspace-old/legacy.service.ts';
  const directoryHint = 'src/application/workspace';

  it('matches exact file hints', () => {
    expect(matchesIterationPathHint(workspaceFile, workspaceFile)).toBe(true);
  });

  it('matches directory descendants with segment boundaries', () => {
    expect(matchesIterationPathHint(workspaceFile, directoryHint)).toBe(true);
    expect(matchesIterationPathHint(nestedFile, directoryHint)).toBe(true);
  });

  it('does not match sibling prefix collisions', () => {
    expect(matchesIterationPathHint(siblingPrefixFile, directoryHint)).toBe(false);
  });

  it('normalizes Windows-style directory hints', () => {
    expect(matchesIterationPathHint(workspaceFile, 'src\\application\\workspace')).toBe(true);
  });

  it('rejects unsafe absolute or traversal paths', () => {
    expect(matchesIterationPathHint('/etc/passwd', directoryHint)).toBe(false);
    expect(matchesIterationPathHint('src/../secrets/env.ts', directoryHint)).toBe(false);
  });
});

describe('iteration path hint scoring', () => {
  const taskText = 'Implement bounded activity history recorder in application workspace.';
  const queryVariants = expandQueryTokens(tokenize(taskText));
  const categories = inferTaskCategories(taskText);
  const modulePaths = new Set(['src/application/workspace']);
  const directoryHint = new Set(['src/application/workspace']);
  const workspaceFile = 'src/application/workspace/activity-history.service.ts';
  const unrelatedFile = 'src/core/project-brain/types/project-brain.ts';

  it('boosts workspace descendants for directory hints when baseScore >= 1', () => {
    const withoutHint = scoreCandidatePath(
      workspaceFile,
      queryVariants,
      categories,
      modulePaths,
      taskText,
    );
    const withDirectoryHint = scoreCandidatePath(
      workspaceFile,
      queryVariants,
      categories,
      modulePaths,
      taskText,
      directoryHint,
    );
    expect(withoutHint).toBeGreaterThanOrEqual(1);
    expect(withDirectoryHint - withoutHint).toBe(
      CONTEXT_RETRIEVAL_SCORING.ITERATION_PATH_HINT_BOOST,
    );
  });

  it('does not boost ineligible paths even when the directory hint matches', () => {
    const withoutHint = scoreCandidatePath(
      unrelatedFile,
      queryVariants,
      categories,
      modulePaths,
      taskText,
    );
    expect(withoutHint).toBe(0);
    const withDirectoryHint = scoreCandidatePath(
      unrelatedFile,
      queryVariants,
      categories,
      modulePaths,
      taskText,
      directoryHint,
    );
    expect(withDirectoryHint).toBe(0);
  });

  it('preserves existing ranking behavior without hints', () => {
    const ranked = rankCandidatePaths(
      [
        'src/features/marketing/campaign.ts',
        'src/lib/auth.ts',
        'prisma/schema.prisma',
        'src/app/api/products/route.ts',
      ],
      expandQueryTokens(
        tokenize(
          'Add product reviews with database changes, admin moderation, API endpoints, and tests.',
        ),
      ),
      inferTaskCategories(
        'Add product reviews with database changes, admin moderation, API endpoints, and tests.',
      ),
      new Set(),
      'Add product reviews with database changes, admin moderation, API endpoints, and tests.',
    );
    expect(ranked[0]?.path).toBe('prisma/schema.prisma');
  });
});
