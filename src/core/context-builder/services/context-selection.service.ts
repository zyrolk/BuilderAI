import type { DocumentKind, ParsedMarkdownDocument } from '../../blueprint-reader';
import type { DecisionRecord, PendingWork, ProjectGoal, ProjectTask } from '../../project-brain';
import { CONTEXT_PRIORITY_RANK, DOCUMENT_PRIORITY, MANDATORY_DOCUMENT_KINDS } from '../config';
import { contentFingerprint, relevanceScore, tokenize } from '../internal/text-relevance';
import type {
  CodingStandardContext,
  ContextDocument,
  ContextLimits,
  ContextOmission,
  ContextRisk,
  ContextSelection,
  ContextSourceFile,
  ValidatedContextInput,
} from '../types';
import { diagnosticRiskId, pendingWorkRiskId } from '../types';
import { DependencyResolutionService } from './dependency-resolution.service';

function decisionText(decision: DecisionRecord): string {
  return [
    decision.id,
    decision.title,
    decision.context,
    decision.decision,
    decision.rationale,
    ...decision.alternatives,
  ].join(' ');
}

function pendingWorkText(work: PendingWork): string {
  return `${work.id} ${work.summary}`;
}

function diagnosticRisks(
  diagnostics: ValidatedContextInput['reader']['diagnostics'],
): readonly ContextRisk[] {
  const byCode = Map.groupBy(diagnostics, ({ code }) => code);
  return [...byCode.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map<ContextRisk>(([code, grouped]) => {
      const first = grouped[0];
      if (first === undefined) throw new Error(`Diagnostic group '${code}' is empty.`);
      return {
        id: diagnosticRiskId(first),
        source: 'DOCUMENT_DIAGNOSTIC',
        severity: 'WARNING',
        description:
          grouped.length === 1
            ? first.message
            : `Blueprint Reader reported ${grouped.length} '${code}' warnings; inspect its diagnostics for document-level details.`,
      };
    });
}

function isMandatoryDocument(document: ContextDocument): boolean {
  return MANDATORY_DOCUMENT_KINDS.includes(document.kind);
}

function selectCodingStandards(
  documents: readonly ParsedMarkdownDocument[],
): readonly CodingStandardContext[] {
  const codingStandards = documents.find(({ kind }) => kind === 'coding-standards');
  const source = codingStandards ?? documents.find(({ kind }) => kind === 'ai-rules');
  return (
    source?.sections
      .filter(({ level, content }) => level === 2 && content.length > 0)
      .map(({ heading, content }) => ({ heading, content })) ?? []
  );
}

function deduplicateFiles(
  files: readonly ContextSourceFile[],
  omissions: ContextOmission[],
): readonly ContextSourceFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const fingerprint = contentFingerprint(file.content);
    if (fingerprint.length > 0 && seen.has(fingerprint)) {
      omissions.push({ kind: 'FILE', identifier: file.path, reason: 'DUPLICATE' });
      return false;
    }
    if (fingerprint.length > 0) seen.add(fingerprint);
    return true;
  });
}

export class ContextSelectionService {
  constructor(private readonly dependencyResolver = new DependencyResolutionService()) {}

  async select(input: ValidatedContextInput, limits: ContextLimits): Promise<ContextSelection> {
    const { brain, reader, currentTask, sourceFileSource, sourcePaths } = input;
    const omissions: ContextOmission[] = [];
    const relatedTasks = this.dependencyResolver.resolveTasks(brain, currentTask);
    const taskCorpus = this.dependencyResolver.taskCorpus(currentTask, relatedTasks);
    const query = tokenize(taskCorpus);

    const scoredModules = reader.analysis.modules
      .map((module) => ({
        module,
        score: relevanceScore(query, `${module.path} ${module.owner} ${module.responsibility}`),
      }))
      .filter(({ score }) => score >= 2)
      .sort(
        (left, right) =>
          right.score - left.score || left.module.path.localeCompare(right.module.path),
      )
      .map(({ module }) => module);

    const fileResolution = await this.dependencyResolver.resolveFiles(
      sourcePaths,
      sourceFileSource,
      taskCorpus,
      scoredModules,
      reader.analysis.modules,
      limits.maxSourceReads,
      input.iterationPathHints,
    );
    omissions.push(...fileResolution.omissions);
    const files = deduplicateFiles(fileResolution.files, omissions);

    const modulePaths = new Set(scoredModules.map(({ path }) => path));
    for (const file of files) if (file.modulePath !== undefined) modulePaths.add(file.modulePath);
    const modules = reader.analysis.modules
      .filter(({ path }) => modulePaths.has(path))
      .sort((left, right) => left.path.localeCompare(right.path));

    const decisionQuery = tokenize(
      `${taskCorpus} ${modules.map(({ path, responsibility }) => `${path} ${responsibility}`).join(' ')}`,
    );
    const decisions = brain.decisionLog
      .filter(({ status }) => status === 'ACCEPTED')
      .map((decision) => ({
        decision,
        score: relevanceScore(decisionQuery, decisionText(decision)),
      }))
      .filter(({ score }) => score >= 2)
      .sort(
        (left, right) =>
          right.score - left.score || left.decision.id.localeCompare(right.decision.id),
      )
      .map(({ decision }) => decision);

    const goals = this.selectGoals(brain.blueprint.goals, query);
    const documents = this.selectDocuments(reader.documents, query, limits, omissions);
    const risks: ContextRisk[] = [
      ...diagnosticRisks(reader.diagnostics),
      ...brain.memory.pendingWork
        .filter((work) => relevanceScore(decisionQuery, pendingWorkText(work)) >= 2)
        .map<ContextRisk>((work) => ({
          id: pendingWorkRiskId(work),
          source: 'PENDING_WORK',
          severity: work.priority,
          description: work.summary,
        })),
    ];

    const tasksForBlockers: readonly ProjectTask[] = [currentTask, ...relatedTasks];
    const blockers = tasksForBlockers
      .filter(
        (task): task is ProjectTask & { readonly blockerReason: string } =>
          task.status === 'BLOCKED' && task.blockerReason !== undefined,
      )
      .map(({ id, blockerReason }) => ({ taskId: id, reason: blockerReason }));

    return {
      currentTask,
      relatedTasks,
      goals,
      constraints: brain.blueprint.constraints,
      modules,
      files,
      decisions,
      codingStandards: selectCodingStandards(reader.documents),
      risks,
      blockers,
      documents,
      omissions,
      sourcePaths: sourcePaths.length,
      sourceReads: fileResolution.reads,
    };
  }

  private selectGoals(
    goals: readonly ProjectGoal[],
    query: ReadonlySet<string>,
  ): readonly ProjectGoal[] {
    const scored = goals
      .map((goal) => ({
        goal,
        score: relevanceScore(
          query,
          `${goal.id} ${goal.statement} ${goal.successCriteria.join(' ')}`,
        ),
      }))
      .filter(({ score }) => score >= 2)
      .sort((left, right) => right.score - left.score || left.goal.id.localeCompare(right.goal.id))
      .map(({ goal }) => goal);
    return scored.length > 0 ? scored : goals.slice(0, 1);
  }

  private selectDocuments(
    documents: readonly ParsedMarkdownDocument[],
    query: ReadonlySet<string>,
    limits: ContextLimits,
    omissions: ContextOmission[],
  ): readonly ContextDocument[] {
    const candidates = documents
      .filter(
        (
          document,
        ): document is ParsedMarkdownDocument & {
          readonly kind: Exclude<
            DocumentKind,
            'project-brain' | 'architecture' | 'coding-standards'
          >;
        } =>
          document.kind !== 'project-brain' &&
          document.kind !== 'architecture' &&
          document.kind !== 'coding-standards',
      )
      .map<ContextDocument>((document) => ({
        kind: document.kind,
        path: document.path,
        priority: DOCUMENT_PRIORITY[document.kind],
        content: document.content,
      }))
      .filter(
        (document) => isMandatoryDocument(document) || relevanceScore(query, document.content) >= 2,
      )
      .sort(
        (left, right) =>
          CONTEXT_PRIORITY_RANK[left.priority] - CONTEXT_PRIORITY_RANK[right.priority] ||
          left.path.localeCompare(right.path),
      );

    const seen = new Set<string>();
    const unique = candidates.filter((document) => {
      const fingerprint = contentFingerprint(document.content);
      if (seen.has(fingerprint)) {
        omissions.push({ kind: 'DOCUMENT', identifier: document.path, reason: 'DUPLICATE' });
        return false;
      }
      seen.add(fingerprint);
      return true;
    });

    const selected = [...unique];
    while (selected.length > limits.maxDocuments) {
      const removableIndex = selected.findLastIndex((document) => !isMandatoryDocument(document));
      if (removableIndex < 0) break;
      const [removed] = selected.splice(removableIndex, 1);
      if (removed !== undefined) {
        omissions.push({ kind: 'DOCUMENT', identifier: removed.path, reason: 'DOCUMENT_LIMIT' });
      }
    }
    return selected;
  }
}
