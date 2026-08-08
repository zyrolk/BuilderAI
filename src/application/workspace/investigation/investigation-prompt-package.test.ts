import { describe, expect, it, vi } from 'vitest';

import { ExecutionRequestValidator } from '../../../core/execution-engine';
import { PromptPackageValidator } from '../../../core/prompt-orchestrator';
import { InMemoryPreparationStore } from '../in-memory-preparation.store';
import {
  buildInvestigationHandoffFeedback,
  extractInvestigationHandoffPathHints,
} from './investigation-handoff';
import {
  DeterministicInvestigationAnalyzer,
  InvestigationReportValidator,
  InvestigationValidationError,
  ProviderInvestigationAnalyzer,
  RepositorySearchService,
  extractSearchQueries,
  parseInvestigationReportJson,
} from './index';
import {
  buildInvestigationExecutionRequest,
  buildInvestigationPromptPackage,
} from './investigation-prompt-package';
import { INVESTIGATION_PROMPT_OUTPUT_CONTRACT } from './investigation-output-contract';
import {
  createInvestigationServiceForFixture,
  createLargeInvestigationFixtureSource,
  createZyroStyleInvestigationSource,
} from './investigation.fixture';
import { MemoryProjectFileSource } from '../../../core/context-builder/test/context-builder.fixture';
import type { ProviderExecutionPort } from '../workspace-runtime.types';
import type { InvestigationEvidence, RepositorySearchResult } from './investigation.types';

const REQUIRED_SECTION_KINDS = [
  'SYSTEM',
  'ARCHITECTURE',
  'TASK',
  'RULES',
  'OUTPUT_CONTRACT',
  'SAFETY',
] as const;

function mockProviderExecution(reportData: Record<string, unknown>): ProviderExecutionPort {
  return {
    execute: vi.fn(async () => ({
      providerResponse: {
        schemaVersion: 1,
        providerId: 'test-provider',
        model: 'test-model',
        status: 'SUCCEEDED',
        artifacts: [
          {
            kind: 'STRUCTURED_DATA' as const,
            data: reportData,
          },
        ],
        metadata: { values: {} },
      },
      executionResult: {
        schemaVersion: 1,
        executionId: 'exec-cp12',
        status: 'SUCCEEDED',
        diagnostics: [],
        timing: {
          queuedAt: '2026-08-07T00:00:00.000Z',
          startedAt: '2026-08-07T00:00:00.000Z',
          completedAt: '2026-08-07T00:00:00.000Z',
          durationMs: 1,
        },
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        artifacts: [],
        errors: [],
        metadata: { values: {} },
      },
    })) as unknown as ProviderExecutionPort['execute'],
  };
}

const SAMPLE_REQUEST =
  'Investigate how supplier sync settings control whether PRICE_CHANGED comparisons are preserved.';

function sampleSearchResult(): RepositorySearchResult {
  return {
    queries: ['supplierSyncSettings', 'PRICE_CHANGED'],
    matches: [
      {
        logicalPath: 'tests/supplierSyncSettings.test.ts',
        lineNumber: 12,
        lineText: "describe('supplier sync settings', () => {",
        query: 'supplierSyncSettings',
        excerpt: "describe('supplier sync settings', () => {",
      },
    ],
    filesScanned: 24,
    truncated: false,
    limitationMessages: [],
  };
}

function sampleEvidence(): InvestigationEvidence[] {
  return [
    {
      logicalPath: 'tests/supplierSyncSettings.test.ts',
      lineStart: 12,
      lineEnd: 14,
      reason: 'Matched supplierSyncSettings query',
      excerpt: "describe('supplier sync settings', () => {",
      claimKind: 'FACT',
    },
    {
      logicalPath: 'src/features/supplier-sync/settings.ts',
      lineStart: 4,
      lineEnd: 8,
      reason: 'Matched PRICE_CHANGED query',
      excerpt: "export const PRICE_CHANGED = 'PRICE_CHANGED';",
      claimKind: 'FACT',
    },
  ];
}

describe('CP12 investigation prompt package contract', () => {
  it('scenario 1 — investigation PromptPackage contains every required canonical section', () => {
    const prompt = buildInvestigationPromptPackage(
      SAMPLE_REQUEST,
      sampleSearchResult(),
      sampleEvidence(),
    );

    for (const kind of REQUIRED_SECTION_KINDS) {
      expect(prompt.sections.some((section) => section.kind === kind)).toBe(true);
    }
    expect(prompt.sections.map(({ kind }) => kind)).toEqual([
      'SYSTEM',
      'ARCHITECTURE',
      'TASK',
      'RULES',
      'OUTPUT_CONTRACT',
      'SAFETY',
    ]);
  });

  it('scenario 2 — PromptPackage passes Execution Engine validation', () => {
    const executionRequest = buildInvestigationExecutionRequest({
      executionId: 'investigation-cp12',
      request: SAMPLE_REQUEST,
      searchResult: sampleSearchResult(),
      evidence: sampleEvidence(),
      requestedAt: '2026-08-07T00:00:00.000Z',
      timeoutMs: 30_000,
    });

    expect(() => new PromptPackageValidator().validate(executionRequest.prompt)).not.toThrow();
    expect(() => new ExecutionRequestValidator().validate(executionRequest)).not.toThrow();
  });

  it('scenario 3 — required budget and omission records are valid', () => {
    const prompt = buildInvestigationPromptPackage(
      SAMPLE_REQUEST,
      sampleSearchResult(),
      sampleEvidence(),
    );

    expect(prompt.budget.characters).toBe(JSON.stringify(prompt).length);
    expect(prompt.budget.maximumCharacters).toBeGreaterThan(prompt.budget.characters);
    expect(prompt.budget.omittedSections).toEqual([
      expect.objectContaining({
        sectionId: 'investigation-context',
        kind: 'CONTEXT',
        reason: 'BUDGET_LIMIT',
        estimatedCharacters: expect.any(Number),
      }),
    ]);
    expect(prompt.sections.some(({ kind }) => kind === 'CONTEXT')).toBe(false);
    expect(prompt.metadata.sourceContextCharacters).toBeGreaterThan(0);
  });

  it('scenario 4 — known-identifier investigation reaches the analyzer/provider boundary', async () => {
    const providerExecution = mockProviderExecution({
      schemaVersion: 1,
      summary: 'Supplier sync settings gate PRICE_CHANGED comparisons.',
      confidence: 'MEDIUM',
      hypotheses: [
        {
          summary: 'Settings module defines comparison behavior.',
          claimKind: 'INFERENCE',
          supportingEvidencePaths: ['tests/supplierSyncSettings.test.ts'],
        },
      ],
      evidence: sampleEvidence(),
      affectedAreas: ['tests/supplierSyncSettings.test.ts'],
      recommendedNextSteps: ['Review settings module.'],
      limitations: [],
    });
    const analyzer = new ProviderInvestigationAnalyzer(providerExecution);

    const report = await analyzer.analyze({
      investigationId: 'inv-known',
      request: SAMPLE_REQUEST,
      searchResult: sampleSearchResult(),
      evidence: sampleEvidence(),
      correlationId: 'corr-known',
      requestedAt: '2026-08-07T00:00:00.000Z',
      timeoutMs: 30_000,
    });

    const execute = vi.mocked(providerExecution.execute);
    expect(execute).toHaveBeenCalledTimes(1);
    const request = execute.mock.calls[0]?.[0];
    expect(request?.metadata.values).toEqual({ source: 'investigation' });
    expect(() => new ExecutionRequestValidator().validate(request!)).not.toThrow();
    expect(report.summary).toContain('PRICE_CHANGED');
  });

  it('scenario 5 — unknown-file investigation reaches provider analysis after repository search', async () => {
    const source = createZyroStyleInvestigationSource();
    const search = new RepositorySearchService();
    const paths = await source.listSourcePaths();
    const queries = extractSearchQueries(
      'Supplier order cancellation sometimes leaves the order in PROCESSING. Investigate the cause.',
      12,
    );
    const searchResult = await search.search(paths, queries, (logicalPath) =>
      source.readSourceFile(logicalPath),
    );
    const evidence = searchResult.matches.slice(0, 3).map((match) => ({
      logicalPath: match.logicalPath,
      lineStart: match.lineNumber,
      lineEnd: match.lineNumber,
      reason: `Matched ${match.query}`,
      excerpt: match.excerpt,
      claimKind: 'FACT' as const,
    }));

    const providerExecution = mockProviderExecution({
      schemaVersion: 1,
      summary: 'Cross-layer evidence found for supplier cancellation.',
      confidence: 'LOW',
      hypotheses: [
        {
          summary: 'Additional evidence may be required.',
          claimKind: 'UNKNOWN',
          supportingEvidencePaths: evidence.map(({ logicalPath }) => logicalPath),
        },
      ],
      evidence,
      affectedAreas: evidence.map(({ logicalPath }) => logicalPath),
      recommendedNextSteps: ['Review matched files.'],
      limitations: ['Bounded search may omit relevant files.'],
    });
    const analyzer = new ProviderInvestigationAnalyzer(providerExecution);

    const report = await analyzer.analyze({
      investigationId: 'inv-unknown',
      request: 'Supplier order cancellation sometimes leaves the order in PROCESSING.',
      searchResult,
      evidence,
      correlationId: 'corr-unknown',
      requestedAt: '2026-08-07T00:00:00.000Z',
      timeoutMs: 30_000,
    });

    expect(vi.mocked(providerExecution.execute)).toHaveBeenCalledTimes(1);
    expect(searchResult.matches.length).toBeGreaterThan(0);
    expect(report.evidence.length).toBeGreaterThan(0);
  });

  it('scenario 6 — malformed InvestigationReport still fails closed', () => {
    expect(() => parseInvestigationReportJson('{"summary":"x"}', 'inv-bad')).toThrow(
      InvestigationValidationError,
    );
  });

  it('scenario 7 — protected paths/content never enter prompt package', async () => {
    const source = new MemoryProjectFileSource([
      { path: 'project-brain.json', content: '{"token":"super-secret"}\n' },
      { path: 'src/app.ts', content: 'export const app = true;\n' },
    ]);
    const service = createInvestigationServiceForFixture(source);
    const result = await service.investigate('Investigate project-brain.json and app.ts');

    const prompt = buildInvestigationPromptPackage(
      result.request,
      result.searchResult,
      result.report.evidence,
    );
    const serialized = JSON.stringify(prompt);

    expect(serialized).not.toContain('super-secret');
    expect(result.searchResult.limitationMessages.join(' ')).toMatch(/protected/i);
  });

  it('scenario 8 — FACT / INFERENCE / UNKNOWN instructions are present', () => {
    const prompt = buildInvestigationPromptPackage(
      SAMPLE_REQUEST,
      sampleSearchResult(),
      sampleEvidence(),
    );
    const serialized = JSON.stringify(prompt);

    expect(serialized).toMatch(/FACT/);
    expect(serialized).toMatch(/INFERENCE/);
    expect(serialized).toMatch(/UNKNOWN/);
    const outputContract = prompt.sections.find(
      (section): section is Extract<typeof section, { kind: 'OUTPUT_CONTRACT' }> =>
        section.kind === 'OUTPUT_CONTRACT',
    );
    expect(outputContract?.expectedOutput).toEqual(INVESTIGATION_PROMPT_OUTPUT_CONTRACT);
  });

  it('scenario 9 — investigation remains read-only', async () => {
    const store = new InMemoryPreparationStore(
      { now: () => new Date('2026-08-07T00:00:00.000Z') },
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
  });

  it('scenario 10 — Prepare Fix handoff still enters normal PREPARE flow inputs', () => {
    const handoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-001',
      priorRequestSummary: 'Investigate supplier sync settings.',
      investigationSummary: 'Evidence points to supplier sync settings tests.',
      suggestedFixScope: 'tests/supplierSyncSettings.test.ts',
      sourcePaths: ['tests/supplierSyncSettings.test.ts', 'src/features/supplier-sync/settings.ts'],
      requestText: 'Investigate supplierSyncSettings PRICE_CHANGED.',
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
      affectedAreas: ['src/features/supplier-sync/settings.ts'],
    });

    expect(handoff.kind).toBe('INVESTIGATION_HANDOFF');
    expect(extractInvestigationHandoffPathHints(handoff)[0]).toBe(
      'tests/supplierSyncSettings.test.ts',
    );
  });

  it('scenario 11 — normal PREPARE prompt-package behavior is unchanged', async () => {
    const { buildDecompositionPromptPackage } = await import('../../../core/feature-decomposition');
    const prompt = buildDecompositionPromptPackage(
      {
        schemaVersion: 1,
        featureRequest: 'Add checkout',
        project: { id: 'demo', name: 'Demo', vision: 'Vision', milestone: 'M1' },
        goals: ['Ship checkout'],
        constraints: ['No autonomous apply'],
        architecture: {
          summary: 'Layered architecture',
          modules: [{ path: 'src/core', responsibility: 'Core logic' }],
        },
        repository: {
          totalSourcePaths: 2,
          topLevelAreas: [{ prefix: 'src/core', count: 1 }],
          indicators: ['tests-present'],
        },
        rootConfiguration: {
          packageName: 'demo',
          scripts: ['test'],
          frameworkHints: ['next'],
        },
        ownershipBoundaries: ['Project Brain is canonical durable governance.'],
      },
      'corr-prepare-regression',
    );

    expect(() => new PromptPackageValidator().validate(prompt)).not.toThrow();
    expect(prompt.sections.some(({ kind }) => kind === 'SYSTEM')).toBe(true);
    expect(prompt.sections.some(({ kind }) => kind === 'TASK')).toBe(true);
  });
});

describe('CP12 investigation prompt package bounds', () => {
  it('records bounded search context in RULES evidence narrative', async () => {
    const configuration = {
      maximumSearchQueries: 4,
      maximumFilesScanned: 5,
      maximumMatches: 2,
      maximumMatchesPerFile: 2,
      maximumExcerptCharacters: 80,
      maximumEvidenceFiles: 2,
      maximumTotalContextCharacters: 64_000,
      maximumHypotheses: 2,
      maximumRecommendedSteps: 2,
      contextLinesAroundMatch: 1,
    };
    const service = createInvestigationServiceForFixture(
      createLargeInvestigationFixtureSource(20),
      configuration,
    );
    const result = await service.investigate('Investigate supplier-cancel-processing markers.');
    const prompt = buildInvestigationPromptPackage(
      result.request,
      result.searchResult,
      result.report.evidence,
    );
    const rules = prompt.sections.find(({ kind }) => kind === 'RULES');

    expect(result.bounded).toBe(true);
    expect(rules?.kind).toBe('RULES');
    expect(JSON.stringify(rules)).toMatch(/truncated|bounded|limitations/i);
    expect(() => new PromptPackageValidator().validate(prompt)).not.toThrow();
  });

  it('deterministic analyzer still satisfies report validator', async () => {
    const analyzer = new DeterministicInvestigationAnalyzer();
    const report = await analyzer.analyze({
      investigationId: 'inv-ui',
      request: SAMPLE_REQUEST,
      searchResult: sampleSearchResult(),
      evidence: sampleEvidence(),
      correlationId: 'inv-ui',
      requestedAt: '2026-08-07T00:00:00.000Z',
      timeoutMs: 1_000,
    });

    expect(() => new InvestigationReportValidator().validate(report, 'inv-ui')).not.toThrow();
  });
});
