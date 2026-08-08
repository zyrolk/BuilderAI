import { describe, expect, it, vi } from 'vitest';

import { MemoryProjectFileSource } from '../../../core/context-builder/test/context-builder.fixture';
import { InMemoryPreparationStore } from '../in-memory-preparation.store';
import { CHANGE_PLAN } from '../../../ui/workspace/test/workspace.fixture';
import { EMPTY_GATE2_REVIEW } from '../gate2-review/gate2-review.fixture';
import {
  buildInvestigationHandoffFeedback,
  extractInvestigationHandoffPathHints,
} from './investigation-handoff';
import {
  DeterministicInvestigationAnalyzer,
  InvestigationReportValidator,
  InvestigationValidationError,
  RepositorySearchService,
  extractSearchQueries,
  parseInvestigationReportJson,
} from './index';
import {
  createInvestigationServiceForFixture,
  createLargeInvestigationFixtureSource,
  createZyroStyleInvestigationSource,
} from './investigation.fixture';

describe('CP7 investigation scenarios', () => {
  it('scenario 1 — known identifier search finds defining and using files', async () => {
    const service = createInvestigationServiceForFixture(createZyroStyleInvestigationSource());
    const result = await service.investigate(
      'Investigate cancelSupplierOrder behavior. Do not change code yet.',
    );

    expect(
      result.report.evidence.some(({ logicalPath }) =>
        logicalPath.includes('supplier-order-client.ts'),
      ),
    ).toBe(true);
    expect(
      result.report.evidence.some(({ logicalPath }) =>
        logicalPath.includes('order-cancellation.service.ts'),
      ),
    ).toBe(true);
    expect(result.report.affectedAreas.length).toBeGreaterThan(0);
  });

  it('scenario 2 — unknown-file supplier/order bug discovers cross-layer evidence', async () => {
    const service = createInvestigationServiceForFixture(createZyroStyleInvestigationSource());
    const result = await service.investigate(
      'Supplier order cancellation sometimes leaves the order in PROCESSING. Investigate the cause. Do not change code yet.',
    );

    const paths = result.report.evidence.map(({ logicalPath }) => logicalPath);
    expect(paths.some((path) => path.includes('supplier-orders'))).toBe(true);
    expect(
      paths.some((path) => path.includes('server/') || path.includes('OrderCancellation')),
    ).toBe(true);
  });

  it('scenario 3 — stack trace fragments become search evidence', () => {
    const queries = extractSearchQueries(
      `TypeError: Cannot read properties of undefined (reading 'supplierId')
    at cancelSupplierOrder (src/features/supplier-orders/supplier-order-client.ts:12:5)`,
      12,
    );

    expect(queries).toContain('cancelSupplierOrder');
    expect(queries).toContain('supplierId');
    expect(queries.some((query) => query.includes('supplier-order-client'))).toBe(true);
  });

  it('scenario 4 — cross-stack frontend/backend/test evidence can coexist', async () => {
    const service = createInvestigationServiceForFixture(createZyroStyleInvestigationSource());
    const result = await service.investigate(
      'Investigate cancelSupplierOrder across UI, API, and tests. Do not change code.',
    );

    const evidencePaths = result.report.evidence.map(({ logicalPath }) => logicalPath);
    const matchPaths = result.searchResult.matches.map(({ logicalPath }) => logicalPath);
    const paths = [...new Set([...evidencePaths, ...matchPaths])];

    expect(paths.some((path) => path.startsWith('src/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('server/'))).toBe(true);
  });

  it('scenario 5 — insufficient evidence reports unknown root cause without fabricated certainty', async () => {
    const service = createInvestigationServiceForFixture(
      new MemoryProjectFileSource([{ path: 'src/unrelated.ts', content: 'export const x = 1;\n' }]),
    );
    const result = await service.investigate('Mystery bug with no matching repository terms.');

    expect(result.report.confidence).toBe('LOW');
    expect(result.report.likelyRootCause).toBeUndefined();
    expect(result.report.limitations.some((item) => /not established/i.test(item))).toBe(true);
  });

  it('scenario 6 — protected paths never enter search excerpts', async () => {
    const source = new MemoryProjectFileSource([
      { path: 'project-brain.json', content: '{"token":"super-secret"}\n' },
      { path: 'src/app.ts', content: 'export const app = true;\n' },
    ]);
    const service = createInvestigationServiceForFixture(source);
    const result = await service.investigate('Investigate project-brain.json and app.ts');

    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(result.searchResult.limitationMessages.join(' ')).toMatch(/protected/i);
  });

  it('scenario 7 — search bounds are deterministic and recorded', async () => {
    const configuration = {
      maximumSearchQueries: 4,
      maximumFilesScanned: 5,
      maximumMatches: 2,
      maximumMatchesPerFile: 2,
      maximumExcerptCharacters: 80,
      maximumEvidenceFiles: 2,
      maximumTotalContextCharacters: 1_000,
      maximumHypotheses: 2,
      maximumRecommendedSteps: 2,
      contextLinesAroundMatch: 1,
    };
    const service = createInvestigationServiceForFixture(
      createLargeInvestigationFixtureSource(20),
      configuration,
    );
    const result = await service.investigate('Investigate supplier-cancel-processing markers.');

    expect(result.bounded).toBe(true);
    expect(result.searchResult.truncated).toBe(true);
    expect(result.report.limitations.length).toBeGreaterThan(0);
    expect(result.searchResult.matches.length).toBeLessThanOrEqual(2);
  });

  it('scenario 8 — investigation is read-only and does not create apply preparation state', async () => {
    const store = new InMemoryPreparationStore(
      { now: () => new Date('2026-08-05T00:00:00.000Z') },
      10,
    );
    const saveSpy = vi.spyOn(store, 'save');
    const service = createInvestigationServiceForFixture(createZyroStyleInvestigationSource());
    const result = await service.investigate('Investigate cancelSupplierOrder only.');

    expect(result.report.investigationId).toMatch(/^investigation-/);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('changePlan');
    expect(result).not.toHaveProperty('gate2Review');
    saveSpy.mockRestore();
    store.save('prep-test', CHANGE_PLAN, EMPTY_GATE2_REVIEW, new Date('2026-08-05T01:00:00.000Z'));
    expect(store.claim('prep-test').kind).toBe('CLAIMED');
  });

  it('scenario 9 — Prepare Fix handoff exposes bounded relevance-ranked path hints', () => {
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-001',
      priorRequestSummary: 'Investigate supplier cancellation bug.',
      investigationSummary: 'Evidence points to cancellation handler and client.',
      suggestedFixScope: 'server/services/order-cancellation.service.ts',
      sourcePaths: [
        'server/services/order-cancellation.service.ts',
        'src/features/supplier-orders/supplier-order-client.ts',
      ],
      requestText: 'Investigate cancelSupplierOrder supplier cancellation bug.',
      queries: ['cancelSupplierOrder'],
      evidence: [
        {
          logicalPath: 'server/services/order-cancellation.service.ts',
          reason: 'Repository search matched query "cancelSupplierOrder".',
          excerpt: 'cancelSupplierOrder',
          claimKind: 'FACT',
        },
        {
          logicalPath: 'src/features/supplier-orders/supplier-order-client.ts',
          reason: 'Related evidence near search hit.',
          excerpt: 'cancelSupplierOrder',
          claimKind: 'INFERENCE',
        },
      ],
      searchMatches: [
        {
          logicalPath: 'server/services/order-cancellation.service.ts',
          lineNumber: 4,
          lineText: 'export async function cancelSupplierOrder() {}',
          query: 'cancelSupplierOrder',
          excerpt: 'export async function cancelSupplierOrder() {}',
        },
      ],
      hypotheses: [],
      affectedAreas: ['server/services/order-cancellation.service.ts'],
    });

    expect(extractInvestigationHandoffPathHints(handoff)).toEqual([
      'server/services/order-cancellation.service.ts',
      'src/features/supplier-orders/supplier-order-client.ts',
    ]);
    expect(handoff.existingPathHints).toEqual([
      'server/services/order-cancellation.service.ts',
      'src/features/supplier-orders/supplier-order-client.ts',
    ]);
    expect(handoff.kind).toBe('INVESTIGATION_HANDOFF');
  });

  it('scenario 11 — malformed provider report fails closed', () => {
    expect(() => parseInvestigationReportJson('{"summary":"x"}', 'inv-bad')).toThrow(
      InvestigationValidationError,
    );
  });

  it('scenario 12 — same fixture/request yields deterministic search ordering', async () => {
    const source = createZyroStyleInvestigationSource();
    const search = new RepositorySearchService();
    const paths = await source.listSourcePaths();
    const queries = extractSearchQueries('Investigate cancelSupplierOrder', 12);
    const read = (logicalPath: string) => source.readSourceFile(logicalPath);
    const first = await search.search(paths, queries, read);
    const second = await search.search(paths, queries, read);

    expect(first).toEqual(second);
  });
});

describe('DeterministicInvestigationAnalyzer', () => {
  it('labels evidence claim kinds for UI rendering', async () => {
    const analyzer = new DeterministicInvestigationAnalyzer();
    const report = await analyzer.analyze({
      investigationId: 'inv-ui',
      request: 'Investigate cancelSupplierOrder',
      searchResult: {
        queries: ['cancelSupplierOrder'],
        matches: [
          {
            logicalPath: 'src/features/supplier-orders/supplier-order-client.ts',
            lineNumber: 8,
            lineText: 'export async function cancelSupplierOrder(orderId: string): Promise<void> {',
            query: 'cancelSupplierOrder',
            excerpt: 'export async function cancelSupplierOrder(orderId: string): Promise<void> {',
          },
        ],
        filesScanned: 1,
        truncated: false,
        limitationMessages: [],
      },
      evidence: [
        {
          logicalPath: 'src/features/supplier-orders/supplier-order-client.ts',
          lineStart: 8,
          lineEnd: 8,
          reason: 'Matched query',
          excerpt: 'export async function cancelSupplierOrder(orderId: string): Promise<void> {',
          claimKind: 'FACT',
        },
      ],
      correlationId: 'inv-ui',
      requestedAt: '2026-08-05T00:00:00.000Z',
      timeoutMs: 1_000,
    });

    expect(report.evidence[0]?.claimKind).toBe('FACT');
    expect(new InvestigationReportValidator().validate(report, 'inv-ui').confidence).toBe('LOW');
  });
});
