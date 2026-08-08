import { describe, expect, it } from 'vitest';

import { ContextBuilderService } from '../../../core/context-builder';
import { buildPartialSourceExcerpt } from '../../../core/context-builder/internal/partial-source-content';
import {
  applySourceContextPresentation,
  markProtectedSourceFiles,
} from '../../../core/context-builder/internal/source-context-presentation';
import {
  DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION,
  PromptOrchestratorService,
} from '../../../core/prompt-orchestrator';
import { createContextInput } from '../../../core/context-builder/test/context-builder.fixture';
import {
  buildExternalTargetInvestigationPreparePlan,
  buildInvestigationHandoffIterationContent,
  buildPrepareContextSelectionDiagnostics,
  buildCompactInvestigationPrepareTaskText,
} from './external-target-prepare-context.service';
import { EXTERNAL_TARGET_INVESTIGATION_PREPARE_CONTEXT_LIMITS } from './external-target-prepare-context.configuration';
import { buildInvestigationHandoffFeedback } from '../investigation/investigation-handoff';
import { extractSearchQueries } from '../investigation/search-query-extraction';

const supplierSyncFixtureFiles = [
  {
    path: 'tests/supplierSyncSettings.test.ts',
    content:
      "describe('supplierSyncSettings PRICE_CHANGED', () => { it('preserves Cost Price', () => {}); });\n",
  },
  {
    path: 'src/services/supplierSyncSettings.ts',
    content: 'export function compareSupplierPriceChanged() { return true; }\n',
  },
] as const;

const PREPARE_REQUEST =
  'Improve regression coverage for supplier sync settings. Only modify tests/supplierSyncSettings.test.ts. Add a small regression assertion around PRICE_CHANGED when sync flags remain enabled.';

const supplierSyncHandoff = buildInvestigationHandoffFeedback({
  sourceInvestigationId: 'inv-cp14',
  priorRequestSummary:
    'Investigate supplier PRICE_CHANGED comparisons involving Cost Price when supplier sync settings are enabled.',
  investigationSummary: 'Evidence points to supplier sync settings implementation and tests.',
  sourcePaths: ['tests/supplierSyncSettings.test.ts', 'src/services/supplierSyncSettings.ts'],
  requestText: 'Investigate supplier PRICE_CHANGED Cost Price supplierSyncSettings.',
  queries: ['PRICE_CHANGED', 'supplierSyncSettings'],
  evidence: [
    {
      logicalPath: 'tests/supplierSyncSettings.test.ts',
      reason: 'Repository search matched query "supplierSyncSettings".',
      excerpt: 'supplierSyncSettings',
      claimKind: 'FACT',
    },
  ],
  searchMatches: [],
  hypotheses: [],
  affectedAreas: ['src/services/supplierSyncSettings.ts'],
});

describe('CP14 external-target prepare context', () => {
  const handoff = supplierSyncHandoff;

  it('scenario 1 — large external-target context stays under CP14 budget', async () => {
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: supplierSyncHandoff,
    });
    const input = await createContextInput(undefined, [...supplierSyncFixtureFiles]);
    const context = await new ContextBuilderService().build(
      {
        ...input,
        iterationPathHints: plan.iterationPathHints,
        sourceContextPolicy: plan.sourceContextPolicy(false),
      },
      {
        limitOverrides: plan.normalBudget.contextLimits,
        admissionQuotas: plan.normalBudget.admissionQuotas,
      },
    );
    const prompt = await new PromptOrchestratorService().build(
      { context, metadata: { source: 'test' }, iterationFeedback: plan.iterationFeedback },
      {
        ...DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION,
        maximumCharacters: plan.normalBudget.promptMaximumCharacters,
      },
    );
    expect(context.size.characters).toBeLessThanOrEqual(
      EXTERNAL_TARGET_INVESTIGATION_PREPARE_CONTEXT_LIMITS.maxCharacters,
    );
    expect(JSON.stringify(prompt).length).toBeLessThanOrEqual(
      plan.normalBudget.promptMaximumCharacters,
    );
  });

  it('scenario 2 — top FACT/handoff path remains in selected context', async () => {
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: supplierSyncHandoff,
    });
    const input = await createContextInput(undefined, [...supplierSyncFixtureFiles]);
    const context = await new ContextBuilderService().build(
      {
        ...input,
        iterationPathHints: plan.iterationPathHints,
        sourceContextPolicy: plan.sourceContextPolicy(false),
      },
      {
        limitOverrides: plan.normalBudget.contextLimits,
        admissionQuotas: plan.normalBudget.admissionQuotas,
      },
    );
    expect(
      context.relevantFiles.some(({ path }) => path === 'tests/supplierSyncSettings.test.ts'),
    ).toBe(true);
  });

  it('scenario 4 — weak generated paths are omitted before protected evidence paths', async () => {
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: supplierSyncHandoff,
    });
    const generatedFiles = Array.from({ length: 24 }, (_, index) => ({
      path: `src/features/generated/module-${String(index).padStart(2, '0')}.ts`,
      content:
        `export const supplierSyncMarker${index} = 'PRICE_CHANGED supplier sync settings';\n`.repeat(
          20,
        ),
    }));
    const input = await createContextInput(undefined, [
      ...generatedFiles,
      {
        path: 'tests/supplierSyncSettings.test.ts',
        content:
          "describe('supplierSyncSettings PRICE_CHANGED', () => { it('preserves Cost Price', () => {}); });\n",
      },
      {
        path: 'src/services/supplierSyncSettings.ts',
        content: 'export function compareSupplierPriceChanged() { return true; }\n',
      },
    ]);
    const context = await new ContextBuilderService().build(
      {
        ...input,
        iterationPathHints: plan.iterationPathHints,
        sourceContextPolicy: plan.sourceContextPolicy(false),
      },
      {
        limitOverrides: plan.normalBudget.contextLimits,
        admissionQuotas: plan.normalBudget.admissionQuotas,
      },
    );
    const paths = context.relevantFiles.map(({ path }) => path);
    expect(paths).toContain('tests/supplierSyncSettings.test.ts');
    expect(paths.filter((path) => path.startsWith('src/features/generated/')).length).toBeLessThan(
      10,
    );
  });

  it('scenario 6 — investigation handoff appears once via iteration feedback', () => {
    const iteration = buildInvestigationHandoffIterationContent(handoff);
    expect(iteration.apply.status).toBe('FAILED');
    expect(iteration.apply.errors?.[0]?.code).toBe('INVESTIGATION_HANDOFF');
    expect(iteration.apply.updatedPaths).toEqual([]);
    expect(iteration.priorRequestSummary).toMatch(/UPDATE existing paths only/i);
    expect(iteration.priorRequestSummary).toContain('Evidence points to supplier sync');
  });

  it('scenario 7 — existing-path UPDATE intent preserved in iteration feedback', () => {
    const iteration = buildInvestigationHandoffIterationContent(handoff);
    expect(iteration.priorRequestSummary).toMatch(/UPDATE existing paths only/i);
    expect(iteration.apply.updatedPaths).toEqual([]);
    expect(iteration.apply.createdPaths).toEqual([]);
  });

  it('scenario 8 — candidate new-file metadata preserved without global CREATE prohibition', () => {
    const candidateHandoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: handoff.sourceInvestigationId,
      priorRequestSummary: handoff.priorRequestSummary,
      investigationSummary: 'A new diagnostics module may be required.',
      sourcePaths: ['src/services/supplierSyncSettings.ts'],
      requestText: 'Investigate supplierSyncSettings PRICE_CHANGED Cost Price behavior.',
      queries: ['PRICE_CHANGED', 'supplierSyncSettings'],
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
    const iteration = buildInvestigationHandoffIterationContent(candidateHandoff);
    expect(iteration.apply.createdPaths).toEqual([]);
    expect(iteration.priorRequestSummary).toMatch(/CREATE only if required/i);
  });

  it('scenario 12 — compact retry budget is strictly smaller than normal budget', () => {
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: supplierSyncHandoff,
    });
    expect(plan.compactBudget.contextLimits.maxCharacters).toBeLessThan(
      plan.normalBudget.contextLimits.maxCharacters,
    );
    expect(plan.compactBudget.contextLimits.maxFiles).toBeLessThan(
      plan.normalBudget.contextLimits.maxFiles,
    );
    expect(plan.sourceContextPolicy(true).partialContentCharacterLimit).toBeLessThan(
      plan.sourceContextPolicy(false).partialContentCharacterLimit,
    );
  });

  it('scenario 17 — partial excerpt is labelled honestly', () => {
    const excerpt = buildPartialSourceExcerpt('line1\n'.repeat(400), 120);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.content).toMatch(/PARTIAL_EXCERPT/);
  });

  it('scenario 19 — generic stop words are filtered from investigation search queries', () => {
    const queries = extractSearchQueries(
      'Investigate why supplier PRICE_CHANGED comparisons involving Cost Price may not be preserved correctly when settings are enabled. Do not change anything.',
      12,
    );
    expect(queries).not.toContain('and');
    expect(queries).not.toContain('are');
    expect(queries).not.toContain('anything');
    expect(queries).not.toContain('correctly');
    expect(queries).not.toContain('enabled');
  });

  it('scenario 20 — domain tokens remain searchable', () => {
    const queries = extractSearchQueries(
      'Investigate supplierSyncSettings PRICE_CHANGED Cost Price behavior.',
      12,
    );
    expect(queries.some((query) => /PRICE_CHANGED|supplierSyncSettings|Cost/i.test(query))).toBe(
      true,
    );
  });

  it('extracts quoted error fragments and stack file paths as search queries', () => {
    const queries = extractSearchQueries(
      "Investigate failure in src/services/supplierSyncSettings.ts: TypeError: Cannot read property 'PRICE_CHANGED'",
      12,
    );
    expect(queries).toContain('PRICE_CHANGED');
    expect(queries.some((query) => query.includes('supplierSyncSettings'))).toBe(true);
  });

  it('scenario 3/18 — secondary files can be presented as partial excerpts', () => {
    const files = applySourceContextPresentation(
      [
        {
          path: 'tests/supplierSyncSettings.test.ts',
          content: 'full-content\n',
          priority: 'RELATED_SOURCE_FILES',
        },
        {
          path: 'src/noise/generated.ts',
          content: 'x'.repeat(5_000),
          priority: 'RELATED_SOURCE_FILES',
        },
      ],
      {
        protectedPaths: ['tests/supplierSyncSettings.test.ts'],
        priorityPaths: ['tests/supplierSyncSettings.test.ts', 'src/noise/generated.ts'],
        fullContentPaths: ['tests/supplierSyncSettings.test.ts'],
        partialContentCharacterLimit: 200,
      },
    );
    expect(files[0]?.contentPresentation).toBe('FULL');
    expect(files[1]?.contentPresentation).toBe('PARTIAL_EXCERPT');
    expect(files[1]?.content).toMatch(/PARTIAL_EXCERPT/);
  });

  it('scenario 18 — diagnostic metadata reports counts without secret content', () => {
    const diagnostics = buildPrepareContextSelectionDiagnostics({
      compactRetryUsed: true,
      contextPackageCharacters: 12_000,
      promptPackageCharacters: 18_000,
      memoryContextCharacters: 900,
      relevantFiles: [
        {
          path: 'tests/supplierSyncSettings.test.ts',
          content: 'describe("supplierSyncSettings")',
          contentPresentation: 'FULL',
        },
        {
          path: 'src/noise/generated.ts',
          content: '[PARTIAL_EXCERPT]\nexport const x = 1;',
          contentPresentation: 'PARTIAL_EXCERPT',
        },
      ],
      omissions: [
        { kind: 'FILE', identifier: 'src/noise/other.ts' },
        { kind: 'DOCUMENT', identifier: 'docs/unrelated.md' },
      ],
    });
    expect(diagnostics.selectedFileCount).toBe(2);
    expect(diagnostics.fullContentFileCount).toBe(1);
    expect(diagnostics.partialContentFileCount).toBe(1);
    expect(diagnostics.omittedFileCount).toBe(1);
    expect(diagnostics.compactRetryUsed).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toMatch(/api[_-]?key|secret|password/i);
    const noContentDiagnostics = buildPrepareContextSelectionDiagnostics({
      compactRetryUsed: false,
      contextPackageCharacters: 100,
      promptPackageCharacters: 200,
      memoryContextCharacters: 0,
      relevantFiles: [{ path: 'src/empty.ts' }],
      omissions: [],
    });
    expect(noContentDiagnostics.sourceContextCharacters).toBe(0);
  });

  it('scenario 5 — explicit operator path is prioritized in protected paths', () => {
    const explicitHandoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-explicit',
      priorRequestSummary:
        'Fix supplier sync in src/services/supplierSyncSettings.ts when PRICE_CHANGED is ignored.',
      investigationSummary: 'Explicit path cited.',
      sourcePaths: ['src/services/supplierSyncSettings.ts', 'tests/supplierSyncSettings.test.ts'],
      requestText:
        'Fix supplier sync in src/services/supplierSyncSettings.ts when PRICE_CHANGED is ignored.',
      queries: ['supplierSyncSettings', 'PRICE_CHANGED'],
      evidence: [
        {
          logicalPath: 'src/services/supplierSyncSettings.ts',
          reason: 'Explicit operator path from request.',
          excerpt: 'supplierSyncSettings',
          claimKind: 'FACT',
        },
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
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: explicitHandoff,
    });
    expect(explicitHandoff.existingPathHints).toContain('src/services/supplierSyncSettings.ts');
    expect(plan.sourceContextPolicy(false).protectedPaths).toContain(
      'src/services/supplierSyncSettings.ts',
    );
    expect(plan.sourceContextPolicy(false).fullContentPaths).toContain(
      'src/services/supplierSyncSettings.ts',
    );
  });

  it('handoff compaction includes suggested fix scope once in task text', () => {
    const compactTask = buildCompactInvestigationPrepareTaskText(PREPARE_REQUEST, {
      ...handoff,
      suggestedFixScope: 'Update supplier sync comparison only.',
    });
    expect(compactTask).toMatch(/Only modify tests\/supplierSyncSettings\.test\.ts/);
    expect(compactTask).toMatch(/suggestedFixScope: Update supplier sync comparison only/);
    expect(compactTask).toMatch(/UPDATE_FILE/);
    expect(compactTask.split('investigationId:').length).toBe(2);
  });

  it('compact task text omits suggestedFixScope when absent', () => {
    const compactTask = buildCompactInvestigationPrepareTaskText(PREPARE_REQUEST, handoff);
    expect(compactTask).toMatch(/Only modify tests\/supplierSyncSettings\.test\.ts/);
    expect(compactTask).not.toMatch(/suggestedFixScope:/);
  });

  it('iteration feedback can express CREATE-only candidate paths', () => {
    const candidateOnly = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-create-only',
      priorRequestSummary: 'Add diagnostics module.',
      investigationSummary: 'New module may be required.',
      sourcePaths: ['src/features/supplier-sync/settings.ts'],
      requestText: 'Add diagnostics module.',
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
    const iteration = buildInvestigationHandoffIterationContent(candidateOnly);
    expect(iteration.apply.createdPaths).toEqual([]);
    expect(iteration.apply.updatedPaths).toEqual([]);
    expect(iteration.priorRequestSummary).toMatch(/CREATE only if required/i);
  });

  it('deduplicates empty and repeated paths in prepare plan policy', () => {
    const duplicatedHandoff = {
      ...handoff,
      existingPathHints: [
        '',
        'tests/supplierSyncSettings.test.ts',
        'tests/supplierSyncSettings.test.ts',
      ],
      pathHints: [
        'tests/supplierSyncSettings.test.ts',
        'src/services/supplierSyncSettings.ts',
        'src/services/supplierSyncSettings.ts',
      ],
    };
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: duplicatedHandoff,
    });
    expect(plan.sourceContextPolicy(false).protectedPaths).toEqual([
      'tests/supplierSyncSettings.test.ts',
    ]);
  });

  it('partial excerpt returns full content when within budget', () => {
    const excerpt = buildPartialSourceExcerpt('short file', 200);
    expect(excerpt.truncated).toBe(false);
    expect(excerpt.content).toBe('short file');
  });

  it('markProtectedSourceFiles flags protected paths for eviction immunity', () => {
    const files = markProtectedSourceFiles(
      [
        {
          path: 'tests/supplierSyncSettings.test.ts',
          content: 'x',
          priority: 'RELATED_SOURCE_FILES',
        },
        {
          path: 'src/noise/other.ts',
          content: 'y',
          priority: 'RELATED_SOURCE_FILES',
        },
      ],
      ['tests/supplierSyncSettings.test.ts'],
    );
    expect(files[0]?.protectedFromEviction).toBe(true);
    expect(files[1]?.protectedFromEviction).toBeUndefined();
  });

  it('iteration feedback omits path intent when no handoff paths exist', () => {
    const emptyPathsHandoff = buildInvestigationHandoffFeedback({
      sourceInvestigationId: 'inv-empty',
      priorRequestSummary: 'Investigate unknown issue.',
      investigationSummary: 'No paths identified.',
      sourcePaths: [],
      requestText: 'Investigate unknown issue.',
      queries: [],
      evidence: [],
      searchMatches: [],
      hypotheses: [],
      affectedAreas: [],
    });
    const iteration = buildInvestigationHandoffIterationContent(emptyPathsHandoff);
    expect(iteration.apply.updatedPaths).toEqual([]);
    expect(iteration.apply.createdPaths).toEqual([]);
    expect(iteration.priorRequestSummary).not.toMatch(/UPDATE existing paths only/i);
  });

  it('markProtectedSourceFiles returns files unchanged when no protected paths', () => {
    const files = [{ path: 'a.ts', content: 'x', priority: 'RELATED_SOURCE_FILES' as const }];
    expect(markProtectedSourceFiles(files, [])).toBe(files);
  });

  it('applySourceContextPresentation is a no-op without policy', () => {
    const files = [{ path: 'a.ts', content: 'x', priority: 'RELATED_SOURCE_FILES' as const }];
    expect(applySourceContextPresentation(files, undefined)).toBe(files);
  });
});

describe('CP16 external-target investigation prepare ChangePlan prompt fix', () => {
  it('uses the explicit PREPARE request as task text instead of investigation-only summary', () => {
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: supplierSyncHandoff,
    });
    expect(plan.taskText).toContain('Only modify tests/supplierSyncSettings.test.ts');
    expect(plan.taskText).not.toMatch(/^Investigate why supplier PRICE_CHANGED/i);
    expect(plan.taskText).toMatch(/UPDATE_FILE/);
    expect(plan.taskText).toMatch(/Operator prepare request is authoritative/i);
  });

  it('does not claim prior apply success in investigation handoff iteration feedback', () => {
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: supplierSyncHandoff,
    });
    expect(plan.iterationFeedback.apply.status).toBe('FAILED');
    expect(plan.iterationFeedback.apply.updatedPaths).toEqual([]);
    expect(plan.iterationFeedback.apply.errors?.[0]?.code).toBe('INVESTIGATION_HANDOFF');
  });

  it('preserves HARD-scope path signal in prepare intent block for explicit test-only request', () => {
    const plan = buildExternalTargetInvestigationPreparePlan({
      prepareRequest: PREPARE_REQUEST,
      handoff: supplierSyncHandoff,
    });
    expect(plan.taskText).toMatch(/Do not use CREATE_FILE for any path listed above/i);
    expect(plan.taskText).toContain('tests/supplierSyncSettings.test.ts');
  });
});
