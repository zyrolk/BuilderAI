import { BlueprintReaderService } from '@/core/blueprint-reader';
import {
  ContextBuilderService,
  DEFAULT_CONTEXT_LIMITS,
  type ProjectFileSource,
} from '@/core/context-builder';
import {
  loadCanonicalProjectBrain,
  parseProjectBrain,
  type ProjectTask,
} from '@/core/project-brain';
import {
  DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION,
  PromptOrchestratorService,
} from '@/core/prompt-orchestrator';

import {
  MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS,
  MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS,
  CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS,
} from '../workspace/budget-invariant';
import { normalizeIterationFeedback } from '../../application/workspace';
import { NodeFileSystemDocumentSource } from './node-file-system-document-source';
import { NodeProjectFileSource } from '../project/node-project-file-source';

/**
 * A regression guard against P0-3's discovered failure mode: the default Context Builder budget
 * saturating on mandatory-ish governance content alone and starving real source files, while
 * downstream Prompt Orchestrator and provider budgets sat mostly unused. These thresholds are
 * deliberately looser than the exact numbers measured during calibration (ADR-018) so the test
 * stays a meaningful regression floor rather than an exact-value assertion that would flake on
 * every unrelated documentation edit.
 */
const MINIMUM_MEANINGFUL_CONTEXT_HEADROOM_CHARACTERS = CONTEXT_PACKAGE_RESERVED_HEADROOM_CHARACTERS;
const MINIMUM_MEANINGFUL_PROMPT_HEADROOM_CHARACTERS = 10_000;

function createWorstCaseTask(): ProjectTask {
  const summary =
    'Update the change planner risk service and change planner service to compute additional ' +
    'risk warnings for broad change sets, destructive changes, and configuration changes, while ' +
    'preserving workspace visibility preconditions, operation ordering, response processor ' +
    'validation, and project change plan validator behavior. Update context builder, prompt ' +
    'orchestrator, and ai provider request mapper tests as needed. Preserve blueprint reader ' +
    'and project brain contracts. Update architecture documentation and add an ADR describing ' +
    'the risk service change. ';
  const description = summary.repeat(Math.ceil(4_000 / summary.length)).slice(0, 4_000);
  return {
    id: 'p03-worst-case-task',
    title: 'Add retry policy support to the Change Planner risk service',
    description,
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    acceptanceCriteria: [
      'Produce a validated Project Change Plan for explicit review without applying it.',
      'Change planner risk service computes deterministic warnings.',
    ],
    dependencyIds: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('Context/Prompt budget headroom (real Project Brain, real docs, real repository files)', () => {
  it(
    'accepts a worst-case (4,000-character) real request without starving mandatory context, ' +
      'source files, or the Prompt/provider budgets',
    async () => {
      const task = createWorstCaseTask();
      expect(task.description).toHaveLength(4_000);

      const brain = loadCanonicalProjectBrain();
      const reader = await new BlueprintReaderService(
        new NodeFileSystemDocumentSource(process.cwd()),
      ).read();
      const executionBrain = parseProjectBrain({ ...brain, tasks: [...brain.tasks, task] });
      const realSourceFiles: ProjectFileSource = new NodeProjectFileSource(process.cwd());

      const contextPackage = await new ContextBuilderService().build({
        projectBrain: executionBrain,
        blueprintReaderOutput: reader,
        currentTaskId: task.id,
        sourceFileSource: realSourceFiles,
      });

      const contextHeadroom = DEFAULT_CONTEXT_LIMITS.maxCharacters - contextPackage.size.characters;
      expect(contextPackage.size.characters).toBeLessThanOrEqual(
        DEFAULT_CONTEXT_LIMITS.maxCharacters,
      );
      expect(contextHeadroom).toBeGreaterThanOrEqual(
        MINIMUM_MEANINGFUL_CONTEXT_HEADROOM_CHARACTERS,
      );

      // Mandatory governance content must still be present and intact (never truncated).
      expect(contextPackage.relevantDocumentation.map(({ kind }) => kind)).toEqual(
        expect.arrayContaining(['project-constitution', 'ai-rules']),
      );
      expect(contextPackage.codingStandards.length).toBeGreaterThan(0);

      // Real source files must not be completely starved out by governance content.
      expect(contextPackage.size.files).toBeGreaterThan(0);
      expect(contextPackage.relevantFiles.length).toBeGreaterThan(0);

      const promptPackage = await new PromptOrchestratorService().build({
        context: contextPackage,
        metadata: { 'correlation-id': 'budget-regression', source: 'workspace' },
      });

      const promptHeadroom =
        DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters -
        promptPackage.budget.characters;
      expect(promptPackage.budget.characters).toBeLessThanOrEqual(
        DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters,
      );
      expect(promptHeadroom).toBeGreaterThanOrEqual(MINIMUM_MEANINGFUL_PROMPT_HEADROOM_CHARACTERS);

      // The optional CONTEXT section should not need to be dropped under real content.
      expect(promptPackage.budget.omittedSections).toEqual([]);
      expect(promptPackage.sections.map(({ kind }) => kind)).toContain('CONTEXT');

      // Context < Prompt ordering must hold with the same reserved headroom the composition-root
      // invariant requires, proven here against the real measured Context Package size.
      expect(
        DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters -
          DEFAULT_CONTEXT_LIMITS.maxCharacters,
      ).toBeGreaterThanOrEqual(MINIMUM_CONTEXT_TO_PROMPT_HEADROOM_CHARACTERS);

      // What the provider request mapper actually serializes and measures.
      const providerInputLength = JSON.stringify(promptPackage).length;
      const requiredProviderMinimum =
        DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters +
        MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS;
      expect(providerInputLength).toBeLessThan(requiredProviderMinimum);
    },
    30_000,
  );

  it('remains within Prompt and provider budgets when maximum IterationFeedback is attached', async () => {
    const task = createWorstCaseTask();
    const brain = loadCanonicalProjectBrain();
    const reader = await new BlueprintReaderService(
      new NodeFileSystemDocumentSource(process.cwd()),
    ).read();
    const executionBrain = parseProjectBrain({ ...brain, tasks: [...brain.tasks, task] });
    const realSourceFiles: ProjectFileSource = new NodeProjectFileSource(process.cwd());
    const contextPackage = await new ContextBuilderService().build({
      projectBrain: executionBrain,
      blueprintReaderOutput: reader,
      currentTaskId: task.id,
      sourceFileSource: realSourceFiles,
    });
    const iterationFeedback = {
      schemaVersion: 1 as const,
      kind: 'CORRECTION' as const,
      priorRequestSummary: 'x'.repeat(500),
      apply: {
        status: 'PARTIALLY_APPLIED' as const,
        createdPaths: Array.from({ length: 20 }, (_, index) => `src/created-${index}.ts`),
        updatedPaths: Array.from({ length: 20 }, (_, index) => `src/updated-${index}.ts`),
        deletedPaths: Array.from({ length: 20 }, (_, index) => `src/deleted-${index}.ts`),
        skippedPaths: Array.from({ length: 20 }, (_, index) => `src/skipped-${index}.ts`),
        errors: Array.from({ length: 8 }, (_, index) => ({
          code: 'FILESYSTEM_OPERATION_FAILED',
          message: `Operation ${index} failed with a bounded safe message.`,
          logicalPath: `src/error-${index}.ts`,
        })),
        warnings: Array.from({ length: 4 }, (_, index) => ({
          code: 'APPLY_WARNING',
          message: `Warning ${index}.`,
        })),
      },
      verification: {
        status: 'FAILED' as const,
        stages: [
          {
            stage: 'BUILD_VALIDATION' as const,
            status: 'FAILED' as const,
            errors: Array.from({ length: 4 }, (_, index) => ({
              code: 'BUILD_FAILED',
              message: `Stage error ${index}.`,
              stage: 'BUILD_VALIDATION' as const,
            })),
            warnings: [{ code: 'BUILD_WARNING', message: 'Stage warning.' }],
            metadata: { 'exit-code': 1, 'output-truncated': true, duration: 12 },
          },
        ],
        topErrors: Array.from({ length: 8 }, (_, index) => ({
          code: 'BUILD_FAILED',
          message: `Top error ${index}.`,
          stage: 'BUILD_VALIDATION' as const,
        })),
      },
    };

    const normalizedFeedback = normalizeIterationFeedback(iterationFeedback);

    const promptPackage = await new PromptOrchestratorService().build({
      context: contextPackage,
      iterationFeedback: normalizedFeedback,
      metadata: { 'correlation-id': 'budget-regression-iteration', source: 'workspace' },
    });

    expect(JSON.stringify(normalizedFeedback).length).toBeLessThanOrEqual(4_000);
    expect(promptPackage.budget.characters).toBeLessThanOrEqual(
      DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters,
    );
    expect(promptPackage.sections.some(({ kind }) => kind === 'ITERATION')).toBe(true);
    expect(JSON.stringify(promptPackage).length).toBeLessThan(
      DEFAULT_PROMPT_ORCHESTRATOR_CONFIGURATION.maximumCharacters +
        MINIMUM_PROMPT_TO_PROVIDER_HEADROOM_CHARACTERS,
    );
  }, 30_000);
});
