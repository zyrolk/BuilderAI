import { describe, expect, it } from 'vitest';

import { selectInventoryByRelevance } from './inventory-selection';
import { buildFileOutline } from './file-outline.service';
import { inspectRelativeImports } from './import-inspection';
import { RelatedFilesService } from './related-files.service';
import { RelevantContextService } from './relevant-context.service';

function paddingPaths(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => {
    const id = String(index).padStart(5, '0');
    return `${prefix}/pad-${id}.ts`;
  });
}

describe('inventory selection (ADR-038)', () => {
  it('selects high-relevance paths beyond former lexical 15k cutoff', () => {
    const paths = [...paddingPaths(15_200, 'aaa/padding'), 'zzz/services/ordersApiHandler.ts'];
    const inventory = selectInventoryByRelevance(
      paths,
      {
        requestText: 'Fix the orders API handler regression',
        queries: ['ordersApiHandler', 'orders'],
      },
      { maximumContentScanPaths: 400, maximumRankedInventory: 15_000 },
    );

    expect(inventory.contentScanPaths).toContain('zzz/services/ordersApiHandler.ts');
    expect(inventory.contentScanPaths.length).toBeLessThanOrEqual(400);
    expect(inventory.eligibleCount).toBe(paths.length);
  });
});

describe('file outline', () => {
  it('extracts export names and line numbers with bounds', () => {
    const content = [
      'export function createOrder() {}',
      'export class OrderService {}',
      'export interface Order {}',
      'export type OrderId = string;',
      'export const MAX = 1;',
      'function hidden() {}',
    ].join('\n');
    const outline = buildFileOutline({ logicalPath: 'src/orders.ts', content, maximumEntries: 4 });
    expect(outline.entries[0]).toMatchObject({
      kind: 'EXPORT_FUNCTION',
      name: 'createOrder',
      lineNumber: 1,
    });
    expect(outline.entries.length).toBe(4);
    expect(outline.truncated).toBe(true);
  });
});

describe('import inspection', () => {
  it('resolves relative imports against the catalog', () => {
    const result = inspectRelativeImports({
      fromPath: 'src/orders/service.ts',
      content:
        "import { helper } from '../util/helper';\nimport type { X } from 'lodash';\nexport * from './types';\n",
      sourcePaths: ['src/orders/service.ts', 'src/util/helper.ts', 'src/orders/types.ts'],
    });
    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: '../util/helper',
          relative: true,
          resolvedPath: 'src/util/helper.ts',
        }),
        expect.objectContaining({
          specifier: 'lodash',
          relative: false,
          resolvedPath: undefined,
        }),
        expect.objectContaining({
          specifier: './types',
          relative: true,
          resolvedPath: 'src/orders/types.ts',
        }),
      ]),
    );
  });
});

describe('related files', () => {
  it('finds imports and test counterparts with caps', async () => {
    const files = new Map<string, string>([
      [
        'src/orders/service.ts',
        "import { helper } from '../util/helper';\nexport function createOrder() {}\n",
      ],
      ['src/util/helper.ts', 'export const helper = 1;\n'],
      ['src/orders/service.test.ts', 'describe("service", () => {});\n'],
      ['src/orders/nearby.ts', 'export const nearby = true;\n'],
    ]);
    const service = new RelatedFilesService();
    const result = await service.findRelated({
      anchorPath: 'src/orders/service.ts',
      sourcePaths: [...files.keys()],
      readFile: async (path) => files.get(path) ?? '',
      maximumResults: 16,
    });
    const paths = result.related.map((entry) => entry.logicalPath);
    expect(paths).toContain('src/util/helper.ts');
    expect(paths).toContain('src/orders/service.test.ts');
    expect(result.related.length).toBeLessThanOrEqual(16);
  });
});

describe('relevant context budgets', () => {
  it('returns top-K files within hard caps for API/test/schema goals', async () => {
    const files = new Map<string, string>([
      ['src/api/ordersRoute.ts', 'export function ordersRoute() { return "api"; }\n'],
      ['src/api/ordersRoute.test.ts', 'describe("ordersRoute", () => {});\n'],
      ['prisma/schema.prisma', 'model Order { id String }\n'],
      ...paddingPaths(80, 'src/noise').map((path) => [path, 'export const noise = 1;\n'] as const),
    ]);
    const service = new RelevantContextService();

    const api = await service.retrieve({
      goal: 'Update the orders API route handler',
      sourcePaths: [...files.keys()],
      readFile: async (path) => files.get(path) ?? '',
      maximumFiles: 16,
    });
    expect(api.files.length).toBeLessThanOrEqual(16);
    expect(api.reads).toBeLessThanOrEqual(36);
    expect(api.files.some((file) => file.logicalPath.includes('ordersRoute'))).toBe(true);

    const testGoal = await service.retrieve({
      goal: 'Fix failing ordersRoute unit tests',
      sourcePaths: [...files.keys()],
      readFile: async (path) => files.get(path) ?? '',
    });
    expect(testGoal.files.some((file) => file.logicalPath.includes('ordersRoute.test'))).toBe(true);

    const schema = await service.retrieve({
      goal: 'Update prisma Order schema model',
      sourcePaths: [...files.keys()],
      readFile: async (path) => files.get(path) ?? '',
    });
    expect(schema.files.some((file) => file.logicalPath.includes('schema.prisma'))).toBe(true);
  });
});
