import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import type { PromptIterationContent } from '../../../core/prompt-orchestrator';
import {
  buildInvestigationPrepareIntentBlock,
  type InvestigationHandoffFeedback,
} from '../investigation/investigation-handoff';
import {
  EXTERNAL_TARGET_INVESTIGATION_PREPARE_COMPACT_BUDGET,
  EXTERNAL_TARGET_INVESTIGATION_PREPARE_NORMAL_BUDGET,
  EXTERNAL_TARGET_PREPARE_PROTECTED_PATH_LIMIT,
} from './external-target-prepare-context.configuration';
import type {
  ExternalTargetInvestigationPreparePlan,
  ExternalTargetSourceContextPolicy,
} from './external-target-prepare-context.types';

function uniquePaths(paths: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const path of paths) {
    const normalized = normalizeProjectPath(path);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
}

export function buildCompactInvestigationPrepareTaskText(
  prepareRequest: string,
  handoff: InvestigationHandoffFeedback,
): string {
  const lines = [
    prepareRequest.trim(),
    '',
    buildInvestigationPrepareIntentBlock(handoff),
    '',
    'Operator prepare request is authoritative for this turn.',
    '- Implement the TASK above. Do not treat the investigation as already applied.',
    '- When the TASK explicitly asks to UPDATE an existing evidence path and that path appears in existingPathHints, emit UPDATE_FILE for that path.',
    '- Return an empty operations list only when the TASK cannot be satisfied safely from cited evidence.',
    '',
    'Investigation handoff (read-only provenance; no prior ChangePlan was applied):',
    `- investigationId: ${handoff.sourceInvestigationId}`,
    `- summary: ${handoff.investigationSummary}`,
    ...(handoff.suggestedFixScope === undefined
      ? []
      : [`- suggestedFixScope: ${handoff.suggestedFixScope}`]),
  ];
  return lines.join('\n');
}

export function buildInvestigationHandoffIterationContent(
  handoff: InvestigationHandoffFeedback,
): PromptIterationContent {
  const pathIntent = [
    handoff.existingPathHints.length > 0
      ? `UPDATE existing paths only: ${handoff.existingPathHints.join(', ')}`
      : '',
    handoff.candidatePathHints.length > 0
      ? `CREATE only if required: ${handoff.candidatePathHints.join(', ')}`
      : '',
  ]
    .filter((line) => line.length > 0)
    .join('. ');
  return {
    schemaVersion: 1,
    kind: 'CORRECTION',
    priorRequestSummary: [
      `Investigation handoff ${handoff.sourceInvestigationId}.`,
      handoff.investigationSummary.slice(0, 280),
      pathIntent,
    ]
      .filter((line) => line.length > 0)
      .join(' ')
      .slice(0, 500),
    apply: {
      status: 'FAILED',
      createdPaths: [],
      updatedPaths: [],
      deletedPaths: [],
      skippedPaths: [],
      errors: [
        {
          code: 'INVESTIGATION_HANDOFF',
          message:
            'Read-only investigation handoff only. No prior ChangePlan was applied; implement the TASK request.',
        },
      ],
      warnings: [],
    },
  };
}

export function buildExternalTargetInvestigationPreparePlan(input: {
  readonly prepareRequest: string;
  readonly handoff: InvestigationHandoffFeedback;
}): ExternalTargetInvestigationPreparePlan {
  const protectedPaths = uniquePaths(input.handoff.existingPathHints).slice(
    0,
    EXTERNAL_TARGET_PREPARE_PROTECTED_PATH_LIMIT,
  );
  const priorityPaths = uniquePaths([...protectedPaths, ...input.handoff.pathHints]);
  const fullContentPaths = uniquePaths([
    ...protectedPaths,
    ...input.handoff.pathHints.slice(
      0,
      EXTERNAL_TARGET_INVESTIGATION_PREPARE_NORMAL_BUDGET.fullContentFileLimit,
    ),
  ]).slice(0, EXTERNAL_TARGET_INVESTIGATION_PREPARE_NORMAL_BUDGET.fullContentFileLimit);

  const buildPolicy = (compactRetry: boolean): ExternalTargetSourceContextPolicy => {
    const budget = compactRetry
      ? EXTERNAL_TARGET_INVESTIGATION_PREPARE_COMPACT_BUDGET
      : EXTERNAL_TARGET_INVESTIGATION_PREPARE_NORMAL_BUDGET;
    return {
      protectedPaths,
      priorityPaths,
      fullContentPaths: fullContentPaths.slice(0, budget.fullContentFileLimit),
      partialContentCharacterLimit: budget.partialContentCharacterLimit,
    };
  };

  return {
    taskText: buildCompactInvestigationPrepareTaskText(input.prepareRequest, input.handoff),
    iterationPathHints: [...input.handoff.pathHints],
    iterationFeedback: buildInvestigationHandoffIterationContent(input.handoff),
    normalBudget: EXTERNAL_TARGET_INVESTIGATION_PREPARE_NORMAL_BUDGET,
    compactBudget: EXTERNAL_TARGET_INVESTIGATION_PREPARE_COMPACT_BUDGET,
    sourceContextPolicy: buildPolicy,
  };
}

export function buildPrepareContextSelectionDiagnostics(input: {
  readonly compactRetryUsed: boolean;
  readonly contextPackageCharacters: number;
  readonly promptPackageCharacters: number;
  readonly memoryContextCharacters: number;
  readonly relevantFiles: readonly {
    readonly path: string;
    readonly content?: string;
    readonly contentPresentation?: 'FULL' | 'PARTIAL_EXCERPT';
  }[];
  readonly omissions: readonly { readonly kind: string; readonly identifier: string }[];
}): {
  readonly profile: 'EXTERNAL_TARGET_INVESTIGATION_PREPARE';
  readonly compactRetryUsed: boolean;
  readonly selectedFileCount: number;
  readonly fullContentFileCount: number;
  readonly partialContentFileCount: number;
  readonly omittedFileCount: number;
  readonly sourceContextCharacters: number;
  readonly promptPackageCharacters: number;
  readonly contextPackageCharacters: number;
  readonly memoryContextCharacters: number;
} {
  const fullContentFileCount = input.relevantFiles.filter(
    ({ contentPresentation }) => contentPresentation !== 'PARTIAL_EXCERPT',
  ).length;
  const partialContentFileCount = input.relevantFiles.length - fullContentFileCount;
  const sourceContextCharacters = input.relevantFiles.reduce(
    (total, file) => total + (file.content?.length ?? 0),
    0,
  );
  return {
    profile: 'EXTERNAL_TARGET_INVESTIGATION_PREPARE',
    compactRetryUsed: input.compactRetryUsed,
    selectedFileCount: input.relevantFiles.length,
    fullContentFileCount,
    partialContentFileCount,
    omittedFileCount: input.omissions.filter(({ kind }) => kind === 'FILE').length,
    sourceContextCharacters,
    promptPackageCharacters: input.promptPackageCharacters,
    contextPackageCharacters: input.contextPackageCharacters,
    memoryContextCharacters: input.memoryContextCharacters,
  };
}
