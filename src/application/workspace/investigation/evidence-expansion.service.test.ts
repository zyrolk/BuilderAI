import { describe, expect, it } from 'vitest';

import { MemoryProjectFileSource } from '../../../core/context-builder/test/context-builder.fixture';
import { createWorkspacePathProtectionPolicyFromManifest } from '../../../core/target-project/workspace-path-protection';
import { buildInvestigationHandoffFeedback } from './investigation-handoff';
import {
  EvidenceExpansionService,
  findImplementationCounterpartPaths,
  MAX_IMPLEMENTATION_COUNTERPARTS_PER_HIT,
  MAX_RELATED_PATHS_PER_HIT,
} from './evidence-expansion.service';
import { DEFAULT_INVESTIGATION_CONFIGURATION } from './investigation-configuration';
import type { RepositorySearchMatch } from './investigation.types';

const configuration = {
  ...DEFAULT_INVESTIGATION_CONFIGURATION,
  maximumEvidenceFiles: 8,
};

const supplierSyncFixture = {
  testPath: 'tests/supplierSyncSettings.test.ts',
  implementationPath: 'src/services/supplierSyncSettings.ts',
  backendPath: 'functions/src/scheduled/supplierSyncSettings.ts',
  testContent: `import { compareSupplierPriceChanged } from '../src/services/supplierSyncSettings';\n\ndescribe('supplierSyncSettings PRICE_CHANGED', () => {\n  it('preserves Cost Price', () => {\n    expect(compareSupplierPriceChanged(1, 1)).toBe(true);\n  });\n});\n`,
  implementationContent:
    'export function compareSupplierPriceChanged(left: number, right: number) {\n  return left === right;\n}\n',
  backendContent:
    'export function scheduleSupplierSyncSettings() {\n  return compareSupplierPriceChanged;\n}\n',
};

describe('CP15 evidence expansion', () => {
  const expansion = new EvidenceExpansionService(configuration);

  it('discovers implementation counterpart from a test search hit', () => {
    const counterparts = findImplementationCounterpartPaths(
      supplierSyncFixture.testPath,
      [
        supplierSyncFixture.testPath,
        supplierSyncFixture.implementationPath,
        supplierSyncFixture.backendPath,
      ],
      createWorkspacePathProtectionPolicyFromManifest([]),
    );
    expect(counterparts).toContain(supplierSyncFixture.implementationPath);
    expect(counterparts).toContain(supplierSyncFixture.backendPath);
  });

  it('expands test evidence to implementation and backend module paths', () => {
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: supplierSyncFixture.testPath,
        lineNumber: 3,
        lineText: 'supplierSyncSettings PRICE_CHANGED',
        query: 'supplierSyncSettings',
        excerpt: 'supplierSyncSettings PRICE_CHANGED',
      },
    ];
    const sourcePaths = [
      supplierSyncFixture.testPath,
      supplierSyncFixture.implementationPath,
      supplierSyncFixture.backendPath,
    ];
    const fileContents = {
      [supplierSyncFixture.testPath]: supplierSyncFixture.testContent,
      [supplierSyncFixture.implementationPath]: supplierSyncFixture.implementationContent,
      [supplierSyncFixture.backendPath]: supplierSyncFixture.backendContent,
    };

    const evidence = expansion.expandFromMatches(
      matches,
      sourcePaths,
      fileContents,
      'Investigate supplierSyncSettings PRICE_CHANGED Cost Price behavior.',
      ['supplierSyncSettings', 'PRICE_CHANGED'],
    );

    expect(evidence[0]?.claimKind).toBe('FACT');
    expect(evidence[0]?.logicalPath).toBe(supplierSyncFixture.testPath);
    expect(
      evidence.some(({ logicalPath }) => logicalPath === supplierSyncFixture.implementationPath),
    ).toBe(true);
    expect(
      evidence.some(({ logicalPath }) => logicalPath === supplierSyncFixture.backendPath),
    ).toBe(true);
  });

  it('discovers direct import dependencies from test file content', () => {
    const importedPath = 'src/services/supplierSyncCore.ts';
    const testContent = `import { compareSupplierPriceChanged } from '../src/services/supplierSyncCore';\n\ndescribe('supplierSyncSettings', () => {\n  it('preserves Cost Price', () => {\n    expect(compareSupplierPriceChanged(1, 1)).toBe(true);\n  });\n});\n`;
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: supplierSyncFixture.testPath,
        lineNumber: 1,
        lineText: testContent.split('\n')[0] ?? '',
        query: 'supplierSyncSettings',
        excerpt: 'supplierSyncSettings',
      },
    ];
    const evidence = expansion.expandFromMatches(
      matches,
      [supplierSyncFixture.testPath, importedPath],
      {
        [supplierSyncFixture.testPath]: testContent,
        [importedPath]: supplierSyncFixture.implementationContent,
      },
      'Investigate supplierSyncSettings.',
      ['supplierSyncSettings'],
    );

    const importEvidence = evidence.find(({ logicalPath }) => logicalPath === importedPath);
    expect(importEvidence?.reason).toMatch(/import dependency/i);
  });

  it('keeps FACT evidence ranked ahead of INFERENCE expansion', () => {
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: supplierSyncFixture.testPath,
        lineNumber: 2,
        lineText: 'supplierSyncSettings',
        query: 'supplierSyncSettings',
        excerpt: 'supplierSyncSettings',
      },
    ];
    const evidence = expansion.expandFromMatches(
      matches,
      [supplierSyncFixture.testPath, supplierSyncFixture.implementationPath],
      {
        [supplierSyncFixture.testPath]: supplierSyncFixture.testContent,
        [supplierSyncFixture.implementationPath]: supplierSyncFixture.implementationContent,
      },
      'Investigate supplierSyncSettings.',
      ['supplierSyncSettings'],
    );

    expect(evidence[0]?.claimKind).toBe('FACT');
    expect(evidence.some(({ claimKind }) => claimKind === 'INFERENCE')).toBe(true);
  });

  it('bounds implementation counterpart discovery per hit', () => {
    const sourcePaths = [
      supplierSyncFixture.testPath,
      ...Array.from(
        { length: MAX_IMPLEMENTATION_COUNTERPARTS_PER_HIT + 2 },
        (_, index) => `src/services/supplierSyncSettings-${index}.ts`,
      ),
    ];
    const counterparts = findImplementationCounterpartPaths(
      supplierSyncFixture.testPath,
      sourcePaths,
      createWorkspacePathProtectionPolicyFromManifest([]),
    );
    expect(counterparts.length).toBeLessThanOrEqual(MAX_IMPLEMENTATION_COUNTERPARTS_PER_HIT);
  });

  it('excludes protected paths from expansion candidates', () => {
    const policy = createWorkspacePathProtectionPolicyFromManifest(['server/secrets/']);
    const protectedExpansion = new EvidenceExpansionService(configuration, policy);
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: 'tests/order.test.ts',
        lineNumber: 1,
        lineText: 'order',
        query: 'order',
        excerpt: 'order',
      },
    ];
    const candidates = protectedExpansion.collectCandidatePaths(
      matches,
      ['tests/order.test.ts', 'server/secrets/order.ts', 'src/services/order.ts'],
      { 'tests/order.test.ts': "describe('order', () => {});\n" },
      ['order'],
    );
    expect(candidates).not.toContain('server/secrets/order.ts');
    expect(candidates).toContain('src/services/order.ts');
  });

  it('returns deterministic ordering for counterpart paths', () => {
    const first = findImplementationCounterpartPaths(
      supplierSyncFixture.testPath,
      [
        supplierSyncFixture.testPath,
        supplierSyncFixture.backendPath,
        supplierSyncFixture.implementationPath,
      ],
      createWorkspacePathProtectionPolicyFromManifest([]),
    );
    const second = findImplementationCounterpartPaths(
      supplierSyncFixture.testPath,
      [
        supplierSyncFixture.implementationPath,
        supplierSyncFixture.backendPath,
        supplierSyncFixture.testPath,
      ],
      createWorkspacePathProtectionPolicyFromManifest([]),
    );
    expect(first).toEqual(second);
  });

  it('preserves existing-path handoff metadata for expanded implementation evidence', () => {
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: supplierSyncFixture.testPath,
        lineNumber: 2,
        lineText: 'supplierSyncSettings',
        query: 'supplierSyncSettings',
        excerpt: 'supplierSyncSettings',
      },
    ];
    const evidence = expansion.expandFromMatches(
      matches,
      [supplierSyncFixture.testPath, supplierSyncFixture.implementationPath],
      {
        [supplierSyncFixture.testPath]: supplierSyncFixture.testContent,
        [supplierSyncFixture.implementationPath]: supplierSyncFixture.implementationContent,
      },
      'Investigate supplierSyncSettings.',
      ['supplierSyncSettings'],
    );
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-cp15',
      priorRequestSummary: 'Investigate supplierSyncSettings.',
      investigationSummary: 'Evidence links tests to implementation.',
      sourcePaths: [supplierSyncFixture.testPath, supplierSyncFixture.implementationPath],
      requestText: 'Investigate supplierSyncSettings.',
      queries: ['supplierSyncSettings'],
      evidence,
      searchMatches: matches,
      hypotheses: [],
      affectedAreas: [supplierSyncFixture.implementationPath],
    });

    expect(handoff.existingPathHints).toContain(supplierSyncFixture.testPath);
    expect(handoff.existingPathHints).toContain(supplierSyncFixture.implementationPath);
  });

  it('loads expansion candidates before inference evidence is emitted', async () => {
    const source = new MemoryProjectFileSource([
      {
        path: supplierSyncFixture.testPath,
        content: supplierSyncFixture.testContent,
      },
      {
        path: supplierSyncFixture.implementationPath,
        content: supplierSyncFixture.implementationContent,
      },
    ]);
    const paths = await source.listSourcePaths();
    const matches: RepositorySearchMatch[] = [
      {
        logicalPath: supplierSyncFixture.testPath,
        lineNumber: 2,
        lineText: 'supplierSyncSettings',
        query: 'supplierSyncSettings',
        excerpt: 'supplierSyncSettings',
      },
    ];
    const initialContents = {
      [supplierSyncFixture.testPath]: supplierSyncFixture.testContent,
    };
    const candidates = expansion.collectCandidatePaths(matches, paths, initialContents, [
      'supplierSyncSettings',
    ]);
    expect(candidates).toContain(supplierSyncFixture.implementationPath);
    expect(candidates.length).toBeLessThanOrEqual(MAX_RELATED_PATHS_PER_HIT);
  });
});
