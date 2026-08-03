import { DEFAULT_CONTEXT_LIMITS } from '../types';
import { DependencyResolutionService } from './dependency-resolution.service';
import {
  AUTH_TASK,
  createAuthRepositoryFiles,
  createDatabaseRepositoryFiles,
  createEcommerceRepositoryFiles,
  createLargeFilePressureRepositoryFiles,
  createModuleFloodRepositoryFiles,
  createMonorepoRepositoryFiles,
  createUiRepositoryFiles,
  DATABASE_TASK,
  ECOMMERCE_REVIEW_TASK,
  MONOREPO_CHECKOUT_TASK,
  UI_TASK,
} from '../test/retrieval-repositories.fixture';
import {
  MemoryProjectFileSource,
  createContextInput,
  createSourceFiles,
} from '../test/context-builder.fixture';
import { ContextBuilderService } from './context-builder.service';

function paths(files: readonly { readonly path: string }[]): string[] {
  return files.map(({ path }) => path);
}

describe('Phase 2 task-aware retrieval', () => {
  const resolver = new DependencyResolutionService();

  it('A. selects a cross-section of architecture for an e-commerce review task', async () => {
    const source = new MemoryProjectFileSource(createEcommerceRepositoryFiles());
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      ECOMMERCE_REVIEW_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const selected = paths(resolution.files);
    expect(selected).toEqual(expect.arrayContaining(['prisma/schema.prisma']));
    expect(selected.some((entry) => entry.includes('auth'))).toBe(true);
    expect(selected.some((entry) => entry.includes('order') || entry.includes('purchase'))).toBe(
      true,
    );
    expect(selected.some((entry) => entry.includes('api'))).toBe(true);
    expect(selected.some((entry) => entry.includes('admin') || entry.includes('moderation'))).toBe(
      true,
    );
    expect(selected.some((entry) => entry.includes('test'))).toBe(true);
    expect(resolution.reads).toBeLessThanOrEqual(DEFAULT_CONTEXT_LIMITS.maxSourceReads);
  });

  it('B. prioritizes authentication files over unrelated product/order modules', async () => {
    const source = new MemoryProjectFileSource(createAuthRepositoryFiles());
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      AUTH_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const selected = paths(resolution.files);
    expect(selected.some((entry) => entry.includes('auth') || entry.includes('session'))).toBe(
      true,
    );
    expect(selected.some((entry) => entry.includes('middleware'))).toBe(true);
    expect(selected.filter((entry) => entry.includes('features/products'))).toHaveLength(0);
    expect(selected.filter((entry) => entry.includes('features/orders'))).toHaveLength(0);
  });

  it('C. prioritizes schema and repository files for database-only tasks', async () => {
    const source = new MemoryProjectFileSource(createDatabaseRepositoryFiles());
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      DATABASE_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const selected = paths(resolution.files);
    expect(selected).toEqual(expect.arrayContaining(['prisma/schema.prisma']));
    expect(
      selected.some((entry) => entry.includes('migration') || entry.includes('repository')),
    ).toBe(true);
    expect(selected.some((entry) => entry.includes('marketing/noise'))).toBe(false);
  });

  it('D. prioritizes UI files without injecting schema for UI-only tasks', async () => {
    const source = new MemoryProjectFileSource(createUiRepositoryFiles());
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      UI_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const selected = paths(resolution.files);
    expect(selected.some((entry) => entry.includes('component') || entry.includes('hook'))).toBe(
      true,
    );
    expect(selected.some((entry) => entry.includes('prisma'))).toBe(false);
  });

  it('E. prefers the relevant monorepo package over unrelated packages', async () => {
    const source = new MemoryProjectFileSource(createMonorepoRepositoryFiles());
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      MONOREPO_CHECKOUT_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const selected = paths(resolution.files);
    expect(selected.some((entry) => entry.startsWith('packages/checkout/'))).toBe(true);
    expect(selected.some((entry) => entry.startsWith('packages/catalog/'))).toBe(false);
  });

  it('F. keeps several relevant small files ahead of one giant weakly relevant file', async () => {
    const source = new MemoryProjectFileSource(createLargeFilePressureRepositoryFiles());
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      ECOMMERCE_REVIEW_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const selected = paths(resolution.files).slice(0, DEFAULT_CONTEXT_LIMITS.maxFiles);
    expect(selected.filter((entry) => entry.includes('giant-noise'))).toHaveLength(0);
    expect(selected.length).toBeGreaterThanOrEqual(3);
    expect(selected).toEqual(expect.arrayContaining(['prisma/schema.prisma', 'src/lib/auth.ts']));
  });

  it('G. works with minimal Project Brain folder ownership', async () => {
    const source = new MemoryProjectFileSource(createEcommerceRepositoryFiles());
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      ECOMMERCE_REVIEW_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const selected = paths(resolution.files);
    expect(selected.some((entry) => entry.includes('auth'))).toBe(true);
    expect(selected.some((entry) => entry.includes('prisma'))).toBe(true);
  });

  it('H. produces deterministic selection for the same task and catalog', async () => {
    const source = new MemoryProjectFileSource(createEcommerceRepositoryFiles());
    const catalog = await source.listSourcePaths();
    const first = await resolver.resolveFiles(
      catalog,
      source,
      ECOMMERCE_REVIEW_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const second = await resolver.resolveFiles(
      catalog,
      source,
      ECOMMERCE_REVIEW_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    expect(paths(first.files)).toEqual(paths(second.files));
    expect(first.reads).toEqual(second.reads);
    expect(first.omissions).toEqual(second.omissions);
  });

  it('I. does not consume the entire read budget via module flooding', async () => {
    const source = new MemoryProjectFileSource(createModuleFloodRepositoryFiles());
    const productModule = {
      path: 'src/features/products',
      owner: 'Catalog',
      responsibility: 'Product catalog features and generated product files.',
    };
    const resolution = await resolver.resolveFiles(
      await source.listSourcePaths(),
      source,
      AUTH_TASK,
      [productModule],
      [productModule],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    expect(resolution.reads).toBeLessThanOrEqual(DEFAULT_CONTEXT_LIMITS.maxSourceReads);
    expect(
      resolution.files.filter((file) => file.path.startsWith('src/features/products/generated-'))
        .length,
    ).toBeLessThan(5);
    expect(resolution.files.some((file) => file.path === 'src/lib/auth.ts')).toBe(true);
  });

  it('J. boosts eligible candidates with iteration path hints without forcing ineligible reads', async () => {
    const source = new MemoryProjectFileSource(createAuthRepositoryFiles());
    const catalog = await source.listSourcePaths();
    const withoutHints = await resolver.resolveFiles(
      catalog,
      source,
      AUTH_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
    );
    const withHints = await resolver.resolveFiles(
      catalog,
      source,
      AUTH_TASK,
      [],
      [],
      DEFAULT_CONTEXT_LIMITS.maxSourceReads,
      ['src/lib/auth.ts'],
    );
    expect(withHints.reads).toBeLessThanOrEqual(DEFAULT_CONTEXT_LIMITS.maxSourceReads);
    expect(paths(withHints.files)).toContain('src/lib/auth.ts');
    expect(withHints.reads).toBe(withoutHints.reads);
  });
});

describe('ContextBuilderService Phase 2 integration', () => {
  it('still selects bounded context for the canonical fixture', async () => {
    const source = new MemoryProjectFileSource(createSourceFiles());
    const packageValue = await new ContextBuilderService().build({
      ...(await createContextInput()),
      sourceFileSource: source,
    });
    expect(packageValue.relevantFiles.map(({ path }) => path)).toEqual([
      'src/core/context-builder/dependency.ts',
      'src/core/context-builder/context-builder.ts',
    ]);
    expect(packageValue.size.maxSourceReads).toBe(36);
    expect(packageValue.size.maxFiles).toBe(12);
    expect(packageValue.size.maxCharacters).toBe(95_000);
  });
});
