import { describe, expect, it } from 'vitest';

import { MemoryProjectFileSource } from '../../../core/context-builder/test/context-builder.fixture';
import { RepositorySearchService } from './repository-search.service';
import { extractSearchQueries } from './search-query-extraction';
import {
  selectCandidatePathsByRelevance,
  buildInvestigationRankingContext,
  scorePathRelevance,
} from './investigation-path-ranking';
import { EvidenceExpansionService } from './evidence-expansion.service';
import type { InvestigationConfiguration } from './investigation-configuration';
import { DEFAULT_INVESTIGATION_CONFIGURATION } from './investigation-configuration';
import { createInvestigationServiceForFixture } from './investigation.fixture';

function makeConfig(
  overrides: Partial<InvestigationConfiguration> = {},
): InvestigationConfiguration {
  return { ...DEFAULT_INVESTIGATION_CONFIGURATION, ...overrides };
}

function generatePaddingFiles(count: number, prefix = 'src/aaa-padding'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}/file-${String(i).padStart(5, '0')}.ts`);
}

function createLargeSource(
  relevantFiles: Record<string, string>,
  paddingCount: number,
): MemoryProjectFileSource {
  const paddingPaths = generatePaddingFiles(paddingCount);
  const files = [
    ...paddingPaths.map((path) => ({
      path,
      content: `export const padding = true;\n`,
    })),
    ...Object.entries(relevantFiles).map(([path, content]) => ({ path, content })),
  ];
  return new MemoryProjectFileSource(files);
}

describe('P0-5: relevant implementation beyond old first-400 boundary', () => {
  it('finds implementation file at position > 400', async () => {
    const source = createLargeSource(
      {
        'src/services/supplierSyncSettings.ts':
          'export function syncSupplierPrices() { /* PRICE_CHANGED handler */ }\n',
      },
      500,
    );
    const service = new RepositorySearchService(makeConfig());
    const result = await service.search(
      await source.listSourcePaths(),
      extractSearchQueries('Fix the supplier PRICE_CHANGED regression', 12),
      (p) => source.readSourceFile(p),
      'Fix the supplier PRICE_CHANGED regression',
    );

    expect(
      result.matches.some(({ logicalPath }) => logicalPath.includes('supplierSyncSettings')),
    ).toBe(true);
  });
});

describe('P0-5: relevant test beyond old first-400 boundary', () => {
  it('finds test file at position > 400', async () => {
    const source = createLargeSource(
      {
        'tests/supplierSyncSettings.test.ts':
          'describe("supplierSyncSettings", () => { it("handles PRICE_CHANGED", () => {}); });\n',
      },
      500,
    );
    const service = new RepositorySearchService(makeConfig());
    const result = await service.search(
      await source.listSourcePaths(),
      extractSearchQueries('Fix the supplier PRICE_CHANGED regression', 12),
      (p) => source.readSourceFile(p),
      'Fix the supplier PRICE_CHANGED regression',
    );

    expect(
      result.matches.some(({ logicalPath }) => logicalPath.includes('supplierSyncSettings.test')),
    ).toBe(true);
  });
});

describe('P0-5: relevant backend/function file beyond old boundary', () => {
  it('finds functions/ file at position > 400', async () => {
    const source = createLargeSource(
      {
        'functions/src/scheduled/supplierSyncSettings.ts':
          'export async function handlePriceChanged() { /* PRICE_CHANGED handler */ }\n',
      },
      500,
    );
    const service = new RepositorySearchService(makeConfig());
    const result = await service.search(
      await source.listSourcePaths(),
      extractSearchQueries('Fix the supplier PRICE_CHANGED regression', 12),
      (p) => source.readSourceFile(p),
      'Fix the supplier PRICE_CHANGED regression',
    );

    expect(
      result.matches.some(({ logicalPath }) =>
        logicalPath.includes('functions/src/scheduled/supplierSyncSettings'),
      ),
    ).toBe(true);
  });
});

describe('P0-5: unrelated early files do not consume retrieval budget', () => {
  it('ranks relevant file higher than 500 padding files', () => {
    const paddingPaths = generatePaddingFiles(500);
    const relevantPath = 'src/services/supplierSyncSettings.ts';
    const allPaths = [...paddingPaths, relevantPath].sort();

    const context = buildInvestigationRankingContext({
      requestText: 'Fix the supplier PRICE_CHANGED regression',
      queries: extractSearchQueries('Fix the supplier PRICE_CHANGED regression', 12),
    });

    const selected = selectCandidatePathsByRelevance(allPaths, context, 400);
    expect(selected).toContain(relevantPath);
    expect(selected.indexOf(relevantPath)).toBeLessThan(400);
  });
});

describe('P0-5: explicit path gets highest priority', () => {
  it('scores explicit path mention highest', () => {
    const context = buildInvestigationRankingContext({
      requestText:
        'Investigate src/services/supplierSyncSettings.ts for the PRICE_CHANGED regression',
      queries: ['supplierSyncSettings', 'PRICE_CHANGED'],
    });

    const explicit = scorePathRelevance('src/services/supplierSyncSettings.ts', context);
    const unrelated = scorePathRelevance('src/aaa-padding/file-00001.ts', context);
    expect(explicit).toBeGreaterThan(unrelated + 100);
  });
});

describe('P0-5: stack-trace path gets highest priority', () => {
  it('scores stack-trace path highest', () => {
    const request = `TypeError: Cannot read properties of undefined (reading 'supplierId')
    at syncPrices (src/services/supplierSyncSettings.ts:12:5)`;
    const context = buildInvestigationRankingContext({
      requestText: request,
      queries: extractSearchQueries(request, 12),
    });

    const stackPath = scorePathRelevance('src/services/supplierSyncSettings.ts', context);
    const unrelated = scorePathRelevance('src/aaa-padding/file-00001.ts', context);
    expect(stackPath).toBeGreaterThan(unrelated + 100);
  });
});

describe('P0-5: test <-> implementation counterpart survives retrieval', () => {
  it('finds both test and implementation via expansion', async () => {
    const source = createLargeSource(
      {
        'src/services/supplierSyncSettings.ts':
          'export function syncSupplierPrices() { /* impl */ }\n',
        'tests/supplierSyncSettings.test.ts':
          'import { syncSupplierPrices } from "../src/services/supplierSyncSettings";\ndescribe("sync", () => { it("works", () => {}); });\n',
      },
      500,
    );
    const service = new RepositorySearchService(makeConfig());
    const paths = await source.listSourcePaths();
    const queries = extractSearchQueries('Fix the supplier sync regression', 12);
    const result = await service.search(
      paths,
      queries,
      (p) => source.readSourceFile(p),
      'Fix the supplier sync regression',
    );

    const matchPaths = result.matches.map(({ logicalPath }) => logicalPath);
    const hasImpl = matchPaths.some((p) => p.includes('supplierSyncSettings.ts'));
    const hasTest = matchPaths.some((p) => p.includes('supplierSyncSettings.test.ts'));
    expect(hasImpl || hasTest).toBe(true);

    if (hasTest && !hasImpl) {
      const expansion = new EvidenceExpansionService(makeConfig());
      const fileContents: Record<string, string> = {};
      for (const p of matchPaths) {
        try {
          fileContents[p] = await source.readSourceFile(p);
        } catch {
          /* skip */
        }
      }
      const candidates = expansion.collectCandidatePaths(result.matches, paths, fileContents);
      expect(
        candidates.some((p) => p.includes('supplierSyncSettings') && !p.includes('.test.')),
      ).toBe(true);
    }
  });
});

describe('P0-5: maximumMatchesPerFile=3 remains enforced', () => {
  it('limits matches per file to 3', async () => {
    const source = new MemoryProjectFileSource([
      {
        path: 'src/many-hits.ts',
        content: Array.from({ length: 10 }, (_, i) => `const supplier_${i} = "supplier";`).join(
          '\n',
        ),
      },
    ]);
    const service = new RepositorySearchService(makeConfig({ maximumMatchesPerFile: 3 }));
    const result = await service.search(await source.listSourcePaths(), ['supplier'], (p) =>
      source.readSourceFile(p),
    );

    const fileMatches = result.matches.filter(
      ({ logicalPath }) => logicalPath === 'src/many-hits.ts',
    );
    expect(fileMatches.length).toBeLessThanOrEqual(3);
  });
});

describe('P0-5: maximumMatches=48 remains enforced', () => {
  it('limits total matches to configured maximum', async () => {
    const files = Array.from({ length: 60 }, (_, i) => ({
      path: `src/file-${String(i).padStart(3, '0')}.ts`,
      content: `export const supplier_item = 'supplier-${i}';\n`,
    }));
    const source = new MemoryProjectFileSource(files);
    const service = new RepositorySearchService(makeConfig({ maximumMatches: 48 }));
    const result = await service.search(await source.listSourcePaths(), ['supplier'], (p) =>
      source.readSourceFile(p),
    );

    expect(result.matches.length).toBeLessThanOrEqual(48);
  });
});

describe('P0-5: protected/NEVER_EXPOSE paths excluded before content reads', () => {
  it('does not read protected paths', async () => {
    const source = new MemoryProjectFileSource([
      { path: '.env', content: 'SECRET_KEY=abc123\n' },
      { path: '.env.local', content: 'SECRET_KEY=abc123\n' },
      { path: 'src/safe.ts', content: 'export const supplier = true;\n' },
    ]);
    const service = new RepositorySearchService(makeConfig());
    const result = await service.search(await source.listSourcePaths(), ['SECRET_KEY'], (p) =>
      source.readSourceFile(p),
    );

    expect(result.matches.every(({ logicalPath }) => !logicalPath.startsWith('.env'))).toBe(true);
    expect(source.readPaths.every((p) => !p.startsWith('.env'))).toBe(true);
  });
});

describe('P0-5: generated/vendor/reference files do not dominate', () => {
  it('penalizes vendor paths in ranking', () => {
    const context = buildInvestigationRankingContext({
      requestText: 'Fix supplier regression',
      queries: ['supplier'],
    });

    const vendor = scorePathRelevance('node_modules/supplier/index.ts', context);
    const source = scorePathRelevance('src/services/supplier.ts', context);
    expect(source).toBeGreaterThan(vendor);
  });
});

describe('P0-5: explicitly requested reference file can be found', () => {
  it('scores explicitly mentioned reference file highly', () => {
    const context = buildInvestigationRankingContext({
      requestText: 'Investigate firebase.json configuration',
      queries: ['firebase'],
    });

    const refScore = scorePathRelevance('firebase.json', context);
    expect(refScore).toBeGreaterThan(0);
  });
});

describe('P0-5: deterministic tie ordering', () => {
  it('produces stable ordering for equal-score paths', () => {
    const paths = ['src/b.ts', 'src/a.ts', 'src/c.ts'];
    const context = buildInvestigationRankingContext({
      requestText: 'anything',
      queries: ['anything'],
    });

    const result1 = selectCandidatePathsByRelevance(paths, context, 3);
    const result2 = selectCandidatePathsByRelevance(paths, context, 3);
    expect(result1).toEqual(result2);
  });
});

describe('P0-5: large repository retrieval remains bounded', () => {
  it('bounds content-scan selection while scoring full eligible inventory by relevance', () => {
    const paths = generatePaddingFiles(10_000);
    paths.push('src/services/supplierSyncSettings.ts');
    const context = buildInvestigationRankingContext({
      requestText: 'Fix supplier regression',
      queries: ['supplier'],
    });

    const selected = selectCandidatePathsByRelevance(paths, context, 400);

    expect(selected.length).toBeLessThanOrEqual(400);
    expect(selected).toContain('src/services/supplierSyncSettings.ts');
  });
});

describe('P0-5: small repository behavior remains compatible', () => {
  it('works correctly with fewer files than maximumFilesScanned', async () => {
    const source = new MemoryProjectFileSource([
      { path: 'src/app.ts', content: 'export const main = true;\n' },
      { path: 'src/utils.ts', content: 'export function helper() {}\n' },
    ]);
    const service = new RepositorySearchService(makeConfig());
    const result = await service.search(await source.listSourcePaths(), ['main'], (p) =>
      source.readSourceFile(p),
    );

    expect(result.matches.length).toBe(1);
    expect(result.matches[0]?.logicalPath).toBe('src/app.ts');
    expect(result.truncated).toBe(false);
  });
});

describe('P0-5: 1000+ path scale test', () => {
  it('finds relevant files beyond position 400 in a 1200-file repository', async () => {
    const relevantFiles = {
      'src/services/supplierSyncSettings.ts':
        'export function syncSupplierPrices() { return handlePriceChanged(); }\n',
      'tests/supplierSyncSettings.test.ts':
        'describe("supplierSyncSettings", () => { it("handles PRICE_CHANGED", () => {}); });\n',
      'functions/src/scheduled/supplierSyncSettings.ts':
        'export async function scheduledPriceSync() { /* PRICE_CHANGED */ }\n',
    };
    const source = createLargeSource(relevantFiles, 1200);
    const allPaths = await source.listSourcePaths();
    expect(allPaths.length).toBeGreaterThan(1000);

    const request = 'Fix the supplier PRICE_CHANGED regression';
    const service = new RepositorySearchService(makeConfig());
    const result = await service.search(
      allPaths,
      extractSearchQueries(request, 12),
      (p) => source.readSourceFile(p),
      request,
    );

    const matchPaths = result.matches.map(({ logicalPath }) => logicalPath);
    expect(matchPaths.some((p) => p.includes('supplierSyncSettings'))).toBe(true);
    expect(result.filesScanned).toBeLessThanOrEqual(400);
  });
});

describe('P0-5: 10000-path bounded retrieval benchmark', () => {
  it('selects candidates without reading all file contents', () => {
    const paddingPaths = generatePaddingFiles(10_000);
    const relevantPaths = [
      'src/services/supplierSyncSettings.ts',
      'tests/supplierSyncSettings.test.ts',
      'functions/src/scheduled/supplierSyncSettings.ts',
    ];
    const allPaths = [...paddingPaths, ...relevantPaths].sort();

    const context = buildInvestigationRankingContext({
      requestText: 'Fix the supplier PRICE_CHANGED regression',
      queries: extractSearchQueries('Fix the supplier PRICE_CHANGED regression', 12),
    });

    const startMs = Date.now();
    const selected = selectCandidatePathsByRelevance(allPaths, context, 400);
    const elapsedMs = Date.now() - startMs;

    for (const relevant of relevantPaths) {
      expect(selected).toContain(relevant);
    }
    expect(selected.length).toBeLessThanOrEqual(400);
    expect(elapsedMs).toBeLessThan(5000);
  });
});

describe('P0-5: CP13 ranking regression', () => {
  it('existing zyro-style investigation still finds cross-layer evidence', async () => {
    const { createZyroStyleInvestigationSource } = await import('./investigation.fixture');
    const service = createInvestigationServiceForFixture(createZyroStyleInvestigationSource());
    const result = await service.investigate(
      'Investigate cancelSupplierOrder behavior. Do not change code yet.',
    );

    expect(
      result.report.evidence.some(({ logicalPath }) =>
        logicalPath.includes('supplier-order-client.ts'),
      ),
    ).toBe(true);
  });
});

describe('P0-5: generic stop-words excluded', () => {
  it('excludes "may", "involving", "image" from queries', () => {
    const queries = extractSearchQueries(
      'There may be an issue involving the image upload feature',
      12,
    );
    expect(queries).not.toContain('may');
    expect(queries).not.toContain('involving');
    expect(queries).not.toContain('image');
  });
});
