import type { ContextLimits, SourceFileAdmissionQuotas } from '../../../core/context-builder';
import type { PromptIterationContent } from '../../../core/prompt-orchestrator';

export interface ExternalTargetPrepareContextBudget {
  readonly contextLimits: ContextLimits;
  readonly admissionQuotas: SourceFileAdmissionQuotas;
  readonly partialContentCharacterLimit: number;
  readonly fullContentFileLimit: number;
  readonly memoryContextCharacters: number;
  readonly memoryRelevantRecords: number;
  readonly promptMaximumCharacters: number;
}

export interface ExternalTargetSourceContextPolicy {
  readonly protectedPaths: readonly string[];
  readonly priorityPaths: readonly string[];
  readonly fullContentPaths: readonly string[];
  readonly partialContentCharacterLimit: number;
}

export interface PrepareContextSelectionDiagnostics {
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
}

export interface ExternalTargetInvestigationPreparePlan {
  readonly taskText: string;
  readonly iterationPathHints: readonly string[];
  readonly iterationFeedback: PromptIterationContent;
  readonly normalBudget: ExternalTargetPrepareContextBudget;
  readonly compactBudget: ExternalTargetPrepareContextBudget;
  readonly sourceContextPolicy: (compactRetry: boolean) => ExternalTargetSourceContextPolicy;
}
