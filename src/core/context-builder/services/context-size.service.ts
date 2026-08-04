import { CONTEXT_PRIORITY_RANK, MANDATORY_DOCUMENT_KINDS } from '../config';
import type { ContextLimits, ContextOmission, ContextPackage, ContextSize } from '../types';
import { ContextBuilderValidationError } from '../types';

export type ContextPackageDraft = Omit<ContextPackage, 'size'>;

interface MutableOptionalContext {
  relevantModules: ContextPackage['relevantModules'][number][];
  relevantFiles: ContextPackage['relevantFiles'][number][];
  relevantDecisions: ContextPackage['relevantDecisions'][number][];
  relevantDocumentation: ContextPackage['relevantDocumentation'][number][];
}

function buildPackage(
  draft: ContextPackageDraft,
  context: MutableOptionalContext,
  limits: ContextLimits,
  omissions: readonly ContextOmission[],
  sourcePaths: number,
  sourceReads: number,
): ContextPackage {
  let characters = 0;
  let packageValue: ContextPackage;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const size: ContextSize = {
      characters,
      maxCharacters: limits.maxCharacters,
      files: context.relevantFiles.length,
      maxFiles: limits.maxFiles,
      documents: context.relevantDocumentation.length,
      maxDocuments: limits.maxDocuments,
      sourcePaths,
      maxSourcePaths: limits.maxSourcePaths,
      sourceReads,
      maxSourceReads: limits.maxSourceReads,
      omissions,
    };
    packageValue = { ...draft, ...context, size };
    const measured = JSON.stringify(packageValue).length;
    if (measured === characters) return packageValue;
    characters = measured;
  }
  return {
    ...draft,
    ...context,
    size: {
      characters,
      maxCharacters: limits.maxCharacters,
      files: context.relevantFiles.length,
      maxFiles: limits.maxFiles,
      documents: context.relevantDocumentation.length,
      maxDocuments: limits.maxDocuments,
      sourcePaths,
      maxSourcePaths: limits.maxSourcePaths,
      sourceReads,
      maxSourceReads: limits.maxSourceReads,
      omissions,
    },
  };
}

function removeLowestPriority(context: MutableOptionalContext): ContextOmission | undefined {
  for (let index = context.relevantFiles.length - 1; index >= 0; index -= 1) {
    const file = context.relevantFiles[index];
    if (file?.priority === 'PINNED_BASELINE') continue;
    context.relevantFiles.splice(index, 1);
    return { kind: 'FILE', identifier: file!.path, reason: 'SIZE_LIMIT' };
  }

  const documentIndex = context.relevantDocumentation.findLastIndex(
    ({ kind }) => !MANDATORY_DOCUMENT_KINDS.includes(kind),
  );
  const document = documentIndex < 0 ? undefined : context.relevantDocumentation[documentIndex];
  const documentRank = document === undefined ? -1 : CONTEXT_PRIORITY_RANK[document.priority];
  const decisionRank =
    context.relevantDecisions.length === 0 ? -1 : CONTEXT_PRIORITY_RANK.DECISION_LOG;
  const moduleRank = context.relevantModules.length <= 1 ? -1 : CONTEXT_PRIORITY_RANK.BLUEPRINT;

  if (document !== undefined && documentRank >= decisionRank && documentRank >= moduleRank) {
    context.relevantDocumentation.splice(documentIndex, 1);
    return { kind: 'DOCUMENT', identifier: document.path, reason: 'SIZE_LIMIT' };
  }
  if (decisionRank >= moduleRank) {
    const decision = context.relevantDecisions.pop();
    return decision === undefined
      ? undefined
      : { kind: 'DECISION', identifier: decision.id, reason: 'SIZE_LIMIT' };
  }
  const moduleRecord = context.relevantModules.pop();
  return moduleRecord === undefined
    ? undefined
    : { kind: 'MODULE', identifier: moduleRecord.path, reason: 'SIZE_LIMIT' };
}

export class ContextSizeService {
  measure(
    draft: ContextPackageDraft,
    limits: ContextLimits,
    omissions: readonly ContextOmission[],
    sourcePaths: number,
    sourceReads: number,
  ): number {
    return buildPackage(
      draft,
      {
        relevantModules: [...draft.relevantModules],
        relevantFiles: [...draft.relevantFiles],
        relevantDecisions: [...draft.relevantDecisions],
        relevantDocumentation: [...draft.relevantDocumentation],
      },
      limits,
      omissions,
      sourcePaths,
      sourceReads,
    ).size.characters;
  }

  enforce(
    draft: ContextPackageDraft,
    limits: ContextLimits,
    initialOmissions: readonly ContextOmission[],
    sourcePaths: number,
    sourceReads: number,
  ): ContextPackage {
    const context: MutableOptionalContext = {
      relevantModules: [...draft.relevantModules],
      relevantFiles: [...draft.relevantFiles],
      relevantDecisions: [...draft.relevantDecisions],
      relevantDocumentation: [...draft.relevantDocumentation],
    };
    const omissions = [...initialOmissions];

    while (true) {
      const packageValue = buildPackage(
        draft,
        context,
        limits,
        omissions,
        sourcePaths,
        sourceReads,
      );
      if (packageValue.size.characters <= limits.maxCharacters) return packageValue;

      const omission = removeLowestPriority(context);
      if (omission !== undefined) {
        omissions.push(omission);
        continue;
      }

      throw new ContextBuilderValidationError([
        {
          code: 'CONTEXT_SIZE_EXCEEDED',
          path: '$.limits.maxCharacters',
          message: `Mandatory context requires ${packageValue.size.characters} characters but the limit is ${limits.maxCharacters}`,
        },
      ]);
    }
  }
}
