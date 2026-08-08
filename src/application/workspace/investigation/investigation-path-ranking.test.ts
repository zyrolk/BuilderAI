import { describe, expect, it } from 'vitest';

import { MemoryProjectFileSource } from '../../../core/context-builder/test/context-builder.fixture';
import { DEFAULT_WORKSPACE_PATH_PROTECTION } from '../../../core/target-project/workspace-path-protection';
import { createWorkspacePathProtectionPolicyFromManifest } from '../../../core/target-project/workspace-path-protection';
import {
  buildInvestigationHandoffFeedback,
  buildInvestigationPrepareIntentBlock,
  extractInvestigationHandoffPathHints,
} from './investigation-handoff';
import { EvidenceExpansionService } from './evidence-expansion.service';
import { DEFAULT_INVESTIGATION_CONFIGURATION } from './investigation-configuration';
import {
  buildInvestigationRankingContext,
  mergeRepositoryEvidence,
  rankEvidenceEntries,
  rankSearchMatches,
  scoreSearchMatch,
} from './investigation-path-ranking';
import { RepositorySearchService } from './repository-search.service';
import type { InvestigationEvidence, RepositorySearchMatch } from './investigation.types';

function noisyBlueprintContent(identifier: string): string {
  return Array.from({ length: 120 }, (_, index) => `  "field${index}": "${identifier} reference"`)
    .join(',\n')
    .concat(',\n');
}

describe('CP13 investigation path ranking', () => {
  const configuration = {
    ...DEFAULT_INVESTIGATION_CONFIGURATION,
    maximumMatches: 12,
    maximumMatchesPerFile: 3,
    maximumEvidenceFiles: 8,
  };

  it('scenario 1 — implementation file outranks noisy blueprint/config matches', async () => {
    const source = new MemoryProjectFileSource([
      {
        path: 'firebase-blueprint.json',
        content: `{\n${noisyBlueprintContent('PRICE_CHANGED')}\n}\n`,
      },
      {
        path: 'src/features/supplier-sync/settings.ts',
        content:
          'export function compareSupplierPriceChanged(left: number, right: number) {\n  return left === right;\n}\n',
      },
    ]);
    const paths = await source.listSourcePaths();
    const queries = ['PRICE_CHANGED', 'compareSupplierPriceChanged'];
    const search = new RepositorySearchService(configuration);
    const result = await search.search(
      paths,
      queries,
      (logicalPath) => source.readSourceFile(logicalPath),
      'Investigate supplier PRICE_CHANGED comparison behavior.',
    );

    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.logicalPath).toBe('src/features/supplier-sync/settings.ts');
    expect(
      result.matches.filter(({ logicalPath }) => logicalPath === 'firebase-blueprint.json').length,
    ).toBeLessThanOrEqual(configuration.maximumMatchesPerFile);
  });

  it('scenario 2 — blueprint/config can still rank highly when explicitly targeted', async () => {
    const source = new MemoryProjectFileSource([
      {
        path: 'firebase-blueprint.json',
        content: `{\n${noisyBlueprintContent('orders')}\n}\n`,
      },
      { path: 'src/app.ts', content: 'export const orders = [];\n' },
    ]);
    const paths = await source.listSourcePaths();
    const search = new RepositorySearchService(configuration);
    const result = await search.search(
      paths,
      ['orders'],
      (logicalPath) => source.readSourceFile(logicalPath),
      'Review firebase-blueprint.json orders configuration.',
    );

    expect(result.matches[0]?.logicalPath).toBe('firebase-blueprint.json');
  });

  it('scenario 3 — per-file match cap prevents one file from consuming the global budget', async () => {
    const source = new MemoryProjectFileSource([
      {
        path: 'reference/noisy.json',
        content: Array.from({ length: 40 }, (_, index) => `"token${index}": "supplier-sync"`).join(
          ',\n',
        ),
      },
      { path: 'src/supplier-sync.ts', content: 'export const supplierSync = "supplier-sync";\n' },
    ]);
    const paths = await source.listSourcePaths();
    const search = new RepositorySearchService(configuration);
    const result = await search.search(
      paths,
      ['supplier-sync'],
      (logicalPath) => source.readSourceFile(logicalPath),
      'Investigate supplier-sync.',
    );

    const noisyCount = result.matches.filter(
      ({ logicalPath }) => logicalPath === 'reference/noisy.json',
    ).length;
    expect(noisyCount).toBeLessThanOrEqual(configuration.maximumMatchesPerFile);
    expect(result.matches.some(({ logicalPath }) => logicalPath === 'src/supplier-sync.ts')).toBe(
      true,
    );
  });

  it('scenario 4 — explicit stack-trace path receives strong priority', () => {
    const context = buildInvestigationRankingContext({
      requestText:
        'at compareSupplierPrice (tests/supplierSyncSettings.test.ts:42:10) supplier PRICE_CHANGED failed',
      queries: ['PRICE_CHANGED', 'compareSupplierPrice'],
    });
    const explicit: RepositorySearchMatch = {
      logicalPath: 'tests/supplierSyncSettings.test.ts',
      lineNumber: 42,
      lineText: 'compareSupplierPrice(left, right);',
      query: 'compareSupplierPrice',
      excerpt: 'compareSupplierPrice(left, right);',
    };
    const generic: RepositorySearchMatch = {
      logicalPath: 'docs/reference.md',
      lineNumber: 3,
      lineText: 'PRICE_CHANGED events are documented here.',
      query: 'PRICE_CHANGED',
      excerpt: 'PRICE_CHANGED events are documented here.',
    };

    expect(scoreSearchMatch(explicit, context)).toBeGreaterThan(scoreSearchMatch(generic, context));
    expect(rankSearchMatches([generic, explicit], context, 2)[0]?.logicalPath).toBe(
      'tests/supplierSyncSettings.test.ts',
    );
  });

  it('scenario 5 — implementation and test counterpart both survive evidence selection', () => {
    const context = buildInvestigationRankingContext({
      requestText: 'Investigate supplierSyncSettings PRICE_CHANGED behavior.',
      queries: ['supplierSyncSettings', 'PRICE_CHANGED'],
    });
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: 'src/features/supplier-sync/settings.ts',
        lineNumber: 4,
        lineText: 'export function supplierSyncSettings() {',
        query: 'supplierSyncSettings',
        excerpt: 'export function supplierSyncSettings() {',
      },
    ];
    const evidence: InvestigationEvidence[] = [
      {
        logicalPath: 'src/features/supplier-sync/settings.ts',
        lineStart: 4,
        lineEnd: 4,
        reason: 'Repository search matched query "supplierSyncSettings".',
        excerpt: 'export function supplierSyncSettings() {',
        claimKind: 'FACT',
      },
      {
        logicalPath: 'tests/supplierSyncSettings.test.ts',
        reason: 'Related evidence near search hit.',
        excerpt: "describe('supplierSyncSettings', () => {",
        claimKind: 'INFERENCE',
      },
    ];

    const ranked = rankEvidenceEntries(evidence, context, matches, 8);
    expect(ranked.map(({ logicalPath }) => logicalPath)).toEqual([
      'src/features/supplier-sync/settings.ts',
      'tests/supplierSyncSettings.test.ts',
    ]);
  });

  it('scenario 6 — FACT evidence outranks weak directory-affinity INFERENCE', () => {
    const context = buildInvestigationRankingContext({
      requestText: 'Investigate supplier sync.',
      queries: ['supplier'],
    });
    const fact: InvestigationEvidence = {
      logicalPath: 'src/features/supplier-sync/settings.ts',
      reason: 'Repository search matched query "supplier".',
      excerpt: 'supplier sync settings',
      claimKind: 'FACT',
    };
    const inference: InvestigationEvidence = {
      logicalPath: 'src/features/supplier-sync/unrelated-helper.ts',
      reason: 'Related evidence near search hit.',
      excerpt: 'helper',
      claimKind: 'INFERENCE',
    };

    const ranked = rankEvidenceEntries([inference, fact], context, [], 2);
    expect(ranked[0]?.claimKind).toBe('FACT');
    expect(ranked[0]?.logicalPath).toBe('src/features/supplier-sync/settings.ts');
  });

  it('scenario 7 — handoff path hints are relevance-ranked instead of alphabetical', () => {
    const sourcePaths = [
      'src/a-alpha.ts',
      'src/b-beta.ts',
      'src/c-core.ts',
      'src/d-delta.ts',
      'src/e-echo.ts',
      'src/f-foxtrot.ts',
      'src/g-gamma.ts',
      'src/h-hotel.ts',
      'tests/supplierSyncSettings.test.ts',
    ];
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-rank',
      priorRequestSummary: 'Investigate supplierSyncSettings PRICE_CHANGED.',
      investigationSummary: 'Evidence points to supplier sync settings tests.',
      sourcePaths,
      requestText: 'Investigate supplierSyncSettings PRICE_CHANGED comparisons.',
      queries: ['supplierSyncSettings', 'PRICE_CHANGED'],
      evidence: [
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Repository search matched query "supplierSyncSettings".',
          excerpt: "describe('supplierSyncSettings', () => {",
          claimKind: 'FACT',
        },
      ],
      searchMatches: [
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          lineNumber: 8,
          lineText: "describe('supplierSyncSettings', () => {",
          query: 'supplierSyncSettings',
          excerpt: "describe('supplierSyncSettings', () => {",
        },
      ],
      hypotheses: [],
      affectedAreas: ['src/a-alpha.ts'],
    });

    expect(extractInvestigationHandoffPathHints(handoff)[0]).toBe(
      'tests/supplierSyncSettings.test.ts',
    );
    expect(handoff.pathHints).not.toEqual([...handoff.pathHints].sort());
  });

  it('scenario 8 — identical inputs yield deterministic ordering', async () => {
    const source = new MemoryProjectFileSource([
      { path: 'src/z-last.ts', content: 'export const supplierSync = 1;\n' },
      { path: 'src/a-first.ts', content: 'export const supplierSync = 2;\n' },
    ]);
    const paths = await source.listSourcePaths();
    const search = new RepositorySearchService(configuration);
    const read = (logicalPath: string) => source.readSourceFile(logicalPath);
    const first = await search.search(paths, ['supplierSync'], read, 'supplierSync');
    const second = await search.search(paths, ['supplierSync'], read, 'supplierSync');
    expect(first).toEqual(second);
  });

  it('scenario 9 — handoff marks authoritative existing repository paths', () => {
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-existing',
      priorRequestSummary: 'Investigate supplier sync settings.',
      investigationSummary: 'Update existing settings module.',
      sourcePaths: ['src/features/supplier-sync/settings.ts', 'tests/supplierSyncSettings.test.ts'],
      requestText: 'Investigate supplier sync settings.',
      queries: ['supplierSyncSettings'],
      evidence: [
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Matched in repository search.',
          excerpt: 'supplierSyncSettings',
          claimKind: 'FACT',
        },
      ],
      searchMatches: [],
      hypotheses: [],
      affectedAreas: [],
    });

    expect(handoff.existingPathHints).toContain('tests/supplierSyncSettings.test.ts');
    expect(handoff.candidatePathHints).toEqual([]);
  });

  it('scenario 10 — legitimate new module path is not labeled existing', () => {
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-new',
      priorRequestSummary: 'Add supplier sync diagnostics.',
      investigationSummary: 'A new diagnostics module may be required.',
      sourcePaths: ['src/features/supplier-sync/settings.ts'],
      requestText: 'Add supplier sync diagnostics module.',
      queries: ['diagnostics'],
      evidence: [],
      searchMatches: [],
      hypotheses: [
        {
          summary: 'Introduce diagnostics module.',
          claimKind: 'INFERENCE',
          supportingEvidencePaths: ['src/features/supplier-sync/diagnostics.ts'],
        },
      ],
      affectedAreas: ['src/features/supplier-sync/diagnostics.ts'],
    });

    expect(handoff.candidatePathHints).toContain('src/features/supplier-sync/diagnostics.ts');
    expect(handoff.existingPathHints).not.toContain('src/features/supplier-sync/diagnostics.ts');
  });

  it('scenario 11 — prepare intent tells provider to UPDATE existing evidence paths', () => {
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-prepare',
      priorRequestSummary: 'Investigate supplier sync settings.',
      investigationSummary: 'Evidence points to existing settings test.',
      sourcePaths: ['tests/supplierSyncSettings.test.ts'],
      requestText: 'Investigate supplier sync settings.',
      queries: ['supplierSyncSettings'],
      evidence: [
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Matched in repository search.',
          excerpt: 'supplierSyncSettings',
          claimKind: 'FACT',
        },
      ],
      searchMatches: [],
      hypotheses: [],
      affectedAreas: [],
    });

    const intent = buildInvestigationPrepareIntentBlock(handoff);
    expect(intent).toMatch(/already exist/i);
    expect(intent).toMatch(/UPDATE_FILE/i);
    expect(intent).toMatch(/Do not use CREATE_FILE/i);
    expect(intent).toMatch(/tests\/supplierSyncSettings\.test\.ts/);
  });

  it('scenario 13 — protected paths never enter search evidence', async () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']);
    const source = new MemoryProjectFileSource([
      { path: 'server/secrets/api-config.json', content: '{"supplier":"secret"}\n' },
      { path: 'src/supplier.ts', content: 'export const supplier = true;\n' },
    ]);
    const paths = await source.listSourcePaths();
    const search = new RepositorySearchService(configuration, policy);
    const result = await search.search(
      paths,
      ['supplier'],
      (logicalPath) => source.readSourceFile(logicalPath),
      'Investigate supplier.',
    );

    expect(result.matches.some(({ logicalPath }) => logicalPath.includes('secrets'))).toBe(false);
  });

  it('scenario 14 — evidence expansion preserves ranked FACT before INFERENCE', () => {
    const expansion = new EvidenceExpansionService(
      configuration,
      DEFAULT_WORKSPACE_PATH_PROTECTION,
    );
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: 'src/features/supplier-sync/settings.ts',
        lineNumber: 2,
        lineText: 'export const supplierSyncSettings = {};',
        query: 'supplierSyncSettings',
        excerpt: 'export const supplierSyncSettings = {};',
      },
    ];
    const evidence = expansion.expandFromMatches(
      matches,
      ['src/features/supplier-sync/settings.ts', 'tests/supplierSyncSettings.test.ts'],
      {
        'src/features/supplier-sync/settings.ts': 'export const supplierSyncSettings = {};\n',
        'tests/supplierSyncSettings.test.ts': "describe('supplierSyncSettings', () => {});\n",
      },
      'Investigate supplierSyncSettings.',
      ['supplierSyncSettings'],
    );

    expect(evidence[0]?.claimKind).toBe('FACT');
    expect(
      evidence.some(({ logicalPath }) => logicalPath.includes('supplierSyncSettings.test')),
    ).toBe(true);
  });

  it('ranks UNKNOWN evidence below FACT evidence for the same path', () => {
    const context = buildInvestigationRankingContext({
      requestText: 'Investigate supplier sync.',
      queries: ['supplier'],
    });
    const ranked = rankEvidenceEntries(
      [
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Unknown signal.',
          excerpt: 'supplier',
          claimKind: 'UNKNOWN',
        },
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Repository search matched.',
          excerpt: 'supplier',
          claimKind: 'FACT',
        },
      ],
      context,
      [],
      4,
    );
    expect(ranked[0]?.claimKind).toBe('FACT');
  });

  it('ranks INFERENCE evidence below FACT evidence', () => {
    const context = buildInvestigationRankingContext({
      requestText: 'Investigate supplier sync.',
      queries: ['supplier'],
    });
    const ranked = rankEvidenceEntries(
      [
        {
          logicalPath: 'src/services/supplierSyncSettings.ts',
          reason: 'Inferred from symptoms.',
          excerpt: 'supplier',
          claimKind: 'INFERENCE',
        },
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Repository search matched.',
          excerpt: 'supplier',
          claimKind: 'FACT',
        },
      ],
      context,
      [],
      4,
    );
    expect(ranked[0]?.claimKind).toBe('FACT');
    expect(ranked.some(({ claimKind }) => claimKind === 'INFERENCE')).toBe(true);
  });

  it('merges provider evidence with deterministic repository expansion without dropping INFERENCE', () => {
    const context = buildInvestigationRankingContext({
      requestText: 'Investigate supplierSyncSettings.',
      queries: ['supplierSyncSettings'],
    });
    const matches = [
      {
        logicalPath: 'tests/supplierSyncSettings.test.ts',
        lineNumber: 2,
        lineText: 'supplierSyncSettings',
        query: 'supplierSyncSettings',
        excerpt: 'supplierSyncSettings',
      },
    ];
    const merged = mergeRepositoryEvidence(
      [
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Provider kept only the direct search hit.',
          excerpt: 'supplierSyncSettings',
          claimKind: 'FACT',
        },
      ],
      [
        {
          logicalPath: 'tests/supplierSyncSettings.test.ts',
          reason: 'Repository search matched query.',
          excerpt: 'supplierSyncSettings',
          claimKind: 'FACT',
        },
        {
          logicalPath: 'src/services/supplierSyncSettings.ts',
          reason: 'Implementation counterpart for test evidence.',
          excerpt: 'compareSupplierPriceChanged',
          claimKind: 'INFERENCE',
        },
      ],
      context,
      matches,
      8,
    );

    expect(
      merged.some(({ logicalPath }) => logicalPath === 'tests/supplierSyncSettings.test.ts'),
    ).toBe(true);
    expect(
      merged.some(
        ({ logicalPath, claimKind }) =>
          logicalPath === 'src/services/supplierSyncSettings.ts' && claimKind === 'INFERENCE',
      ),
    ).toBe(true);
    expect(merged[0]?.claimKind).toBe('FACT');
  });
});
