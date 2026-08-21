import type { ModuleAnalysis } from '../../blueprint-reader';
import type { ProjectBrain, ProjectTask } from '../../project-brain';
import { CONTEXT_RETRIEVAL_SCORING } from '../config/context-retrieval-policy';
import {
  extractExplicitPathMentions,
  mergeExplicitPathsIntoShortlist,
} from '../internal/explicit-path-mentions';
import {
  buildReadShortlist,
  isTestCounterpart,
  rankCandidatePaths,
} from '../internal/path-relevance';
import {
  directoryName,
  normalizeProjectPath,
  pathBelongsToModule,
  resolveRelativePath,
} from '../internal/path';
import { categoryEvidenceForPath } from '../internal/source-file-admission';
import {
  inferTaskCategories,
  isTestPrimaryTask,
  sourcePathCategory,
  type TaskCategory,
} from '../internal/task-category';
import {
  boundedContentScore,
  effectiveAdmissionScore,
  expandQueryTokens,
  tokenize,
} from '../internal/text-relevance';
import { ProjectFileSourceAccessDeniedError, type ProjectFileSource } from '../ports';
import type {
  ContextOmission,
  ContextSelectionEvidence,
  ContextSourceFile,
  ProjectSourceFile,
  SourceContextPolicy,
} from '../types';
import { ContextBuilderValidationError } from '../types';

const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

export interface FileResolution {
  readonly files: readonly ContextSourceFile[];
  readonly omissions: readonly ContextOmission[];
  readonly reads: number;
}

interface ScoredSourceFile extends ProjectSourceFile {
  readonly combinedScore: number;
  readonly effectiveScore: number;
  readonly evidence: ContextSelectionEvidence[];
}

function appendEvidence(
  evidence: ContextSelectionEvidence[],
  kind: ContextSelectionEvidence['kind'],
  detail: string,
): ContextSelectionEvidence[] {
  if (evidence.some((entry) => entry.kind === kind && entry.detail === detail)) return evidence;
  return [...evidence, { kind, detail }];
}

function evidenceForShortlistPath(
  sourcePath: string,
  pathScore: number,
  pathHints: ReadonlySet<string>,
  categories: ReadonlySet<TaskCategory>,
): ContextSelectionEvidence[] {
  let evidence: ContextSelectionEvidence[] = [];
  for (const hint of pathHints) {
    if (sourcePath === hint || sourcePath.startsWith(`${hint}/`)) {
      evidence = appendEvidence(evidence, 'EXPLICIT_PATH', hint);
    }
  }
  if (pathScore >= CONTEXT_RETRIEVAL_SCORING.MIN_PATH_SCORE_FOR_READ) {
    evidence = appendEvidence(evidence, 'TASK_KEYWORD', `pathScore=${pathScore}`);
  }
  const category = sourcePathCategory(sourcePath);
  if (category !== undefined && categories.has(category)) {
    evidence = appendEvidence(evidence, 'SOURCE_CATEGORY', category);
  }
  return evidence;
}

function taskText(task: ProjectTask): string {
  return [task.id, task.title, task.description, ...task.acceptanceCriteria].join(' ');
}

function importedPaths(file: ProjectSourceFile): readonly string[] {
  const directory = directoryName(file.path);
  return [...file.content.matchAll(IMPORT_PATTERN)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier?.startsWith('.') === true)
    .map((specifier) => resolveRelativePath(directory, specifier));
}

function findImportedPath(
  importPath: string,
  availablePaths: ReadonlySet<string>,
): string | undefined {
  for (const suffix of SOURCE_SUFFIXES) {
    const candidate = `${importPath}${suffix}`;
    if (availablePaths.has(candidate)) return candidate;
  }
  return undefined;
}

function owningModule(
  filePath: string,
  modules: readonly ModuleAnalysis[],
): ModuleAnalysis | undefined {
  return [...modules]
    .filter((moduleRecord) => pathBelongsToModule(filePath, moduleRecord.path))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

const TEST_FILE_PATTERN = /\.(spec|test)\.(cjs|js|jsx|mjs|ts|tsx)$/u;

function isTestSourcePath(sourcePath: string): boolean {
  return TEST_FILE_PATTERN.test(sourcePath) || sourcePath.includes('/__tests__/');
}

function isSecondaryTestArtifact(sourcePath: string): boolean {
  return isTestSourcePath(sourcePath) || sourcePath.includes('.fixture.');
}

function compareScoredFiles(
  left: ScoredSourceFile,
  right: ScoredSourceFile,
  testPrimary: boolean,
): number {
  const scoreFor = (file: ScoredSourceFile): number => {
    if (testPrimary || !isSecondaryTestArtifact(file.path)) return file.effectiveScore;
    return file.effectiveScore * 0.75;
  };
  const leftScore = scoreFor(left);
  const rightScore = scoreFor(right);
  return (
    rightScore - leftScore ||
    right.combinedScore - left.combinedScore ||
    left.path.length - right.path.length ||
    left.path.localeCompare(right.path)
  );
}

export class DependencyResolutionService {
  resolveTasks(brain: ProjectBrain, currentTask: ProjectTask): readonly ProjectTask[] {
    const tasksById = new Map(brain.tasks.map((task) => [task.id, task]));
    const resolved: ProjectTask[] = [];
    const visited = new Set<string>();

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      const task = tasksById.get(taskId);
      if (task === undefined) return;
      task.dependencyIds.forEach(visit);
      resolved.push(task);
    };

    currentTask.dependencyIds.forEach(visit);
    return resolved;
  }

  async resolveFiles(
    sourcePaths: readonly string[],
    source: ProjectFileSource,
    taskCorpus: string,
    relevantModules: readonly ModuleAnalysis[],
    allModules: readonly ModuleAnalysis[],
    maxReads: number,
    iterationPathHints: readonly string[] = [],
    sourceContextPolicy?: SourceContextPolicy,
  ): Promise<FileResolution> {
    const normalizedPaths = sourcePaths.map(normalizeProjectPath);
    const availablePaths = new Set(normalizedPaths);
    const queryVariants = expandQueryTokens(tokenize(taskCorpus));
    const categories = inferTaskCategories(taskCorpus);
    const testPrimary = isTestPrimaryTask(taskCorpus, categories);
    const scoredModulePaths = new Set(relevantModules.map(({ path }) => path));
    const explicitPaths = extractExplicitPathMentions(taskCorpus, normalizedPaths);
    const pathHints = new Set([
      ...iterationPathHints,
      ...explicitPaths,
      ...(sourceContextPolicy?.priorityPaths ?? []),
    ]);
    const rankedPaths = rankCandidatePaths(
      normalizedPaths,
      queryVariants,
      categories,
      scoredModulePaths,
      taskCorpus,
      new Set(iterationPathHints),
      new Set(explicitPaths),
    );
    const pathScoreByPath = new Map(rankedPaths.map(({ path, pathScore }) => [path, pathScore]));
    const eligiblePaths = rankedPaths.filter(
      ({ pathScore }) => pathScore >= CONTEXT_RETRIEVAL_SCORING.MIN_PATH_SCORE_FOR_READ,
    );
    const shortlist = mergeExplicitPathsIntoShortlist(
      buildReadShortlist(
        eligiblePaths,
        categories,
        CONTEXT_RETRIEVAL_SCORING.READ_SHORTLIST_CAPACITY,
        taskCorpus,
      ),
      [...explicitPaths, ...(sourceContextPolicy?.priorityPaths ?? [])],
      CONTEXT_RETRIEVAL_SCORING.READ_SHORTLIST_CAPACITY,
    );

    const omissions: ContextOmission[] = [];
    const scoredFiles = new Map<string, ScoredSourceFile>();
    let reads = 0;
    let fileLimitRecorded = false;
    const recordFileLimit = (identifier: string): void => {
      if (fileLimitRecorded) return;
      omissions.push({ kind: 'FILE', identifier, reason: 'FILE_LIMIT' });
      fileLimitRecorded = true;
    };

    const readFile = async (
      sourcePath: string,
      pathScore: number,
      contentScoreBoost: number,
      incomingEvidence: readonly ContextSelectionEvidence[] = [],
    ): Promise<void> => {
      if (scoredFiles.has(sourcePath)) return;
      if (reads >= maxReads) {
        recordFileLimit(sourcePath);
        return;
      }

      let content: string;
      try {
        content = await source.readSourceFile(sourcePath);
        reads += 1;
      } catch (error: unknown) {
        if (error instanceof ProjectFileSourceAccessDeniedError) return;
        throw new ContextBuilderValidationError([
          {
            code: 'INVALID_REFERENCE',
            path: '$.sourceFileSource',
            message: `Could not read '${sourcePath}': ${error instanceof Error ? error.message : 'unknown error'}`,
          },
        ]);
      }

      const contentScore = boundedContentScore(
        queryVariants,
        content,
        CONTEXT_RETRIEVAL_SCORING.CONTENT_OVERLAP,
        CONTEXT_RETRIEVAL_SCORING.CONTENT_SCORE_CAP,
      );
      const combinedScore = pathScore + contentScore + contentScoreBoost;
      const category = categoryEvidenceForPath(sourcePath);
      const evidence =
        incomingEvidence.length > 0
          ? [...incomingEvidence]
          : evidenceForShortlistPath(sourcePath, pathScore, pathHints, categories);
      let finalEvidence = evidence;
      if (isTestSourcePath(sourcePath) && testPrimary) {
        finalEvidence = appendEvidence(
          finalEvidence,
          'NEARBY_TEST',
          sourcePath.split('/').at(-1) ?? sourcePath,
        );
      }
      scoredFiles.set(sourcePath, {
        path: sourcePath,
        content,
        combinedScore,
        effectiveScore: effectiveAdmissionScore(combinedScore, content.length),
        evidence:
          category === undefined
            ? finalEvidence
            : appendEvidence(finalEvidence, 'SOURCE_CATEGORY', category),
      });
    };

    for (const sourcePath of shortlist) {
      await readFile(sourcePath, pathScoreByPath.get(sourcePath) ?? 0, 0);
    }

    for (const priorityPath of sourceContextPolicy?.priorityPaths ?? []) {
      if (!availablePaths.has(priorityPath) || scoredFiles.has(priorityPath)) continue;
      await readFile(
        priorityPath,
        Math.max(
          pathScoreByPath.get(priorityPath) ?? 0,
          CONTEXT_RETRIEVAL_SCORING.EXPLICIT_PATH_BOOST,
        ),
        CONTEXT_RETRIEVAL_SCORING.EXPLICIT_PATH_BOOST,
        appendEvidence([], 'EXPLICIT_PATH', priorityPath),
      );
    }

    const rerankedParents = [...scoredFiles.values()].sort((left, right) =>
      compareScoredFiles(left, right, testPrimary),
    );
    const importParents = rerankedParents.slice(
      0,
      CONTEXT_RETRIEVAL_SCORING.DEPENDENCY_PARENT_LIMIT,
    );

    const visitImport = async (parent: ScoredSourceFile, importPath: string): Promise<void> => {
      const dependencyPath = findImportedPath(importPath, availablePaths);
      if (dependencyPath === undefined) {
        if (reads >= maxReads) {
          recordFileLimit(importPath);
          return;
        }
        try {
          await source.readSourceFile(importPath);
          reads += 1;
        } catch (error: unknown) {
          if (error instanceof ProjectFileSourceAccessDeniedError) return;
          throw new ContextBuilderValidationError([
            {
              code: 'INVALID_REFERENCE',
              path: '$.sourceFileSource',
              message: `Source file '${parent.path}' references unavailable relative import '${importPath}'`,
            },
          ]);
        }
        return;
      }
      if (scoredFiles.has(dependencyPath)) return;
      await readFile(
        dependencyPath,
        Math.max(
          pathScoreByPath.get(dependencyPath) ?? 0,
          parent.combinedScore * CONTEXT_RETRIEVAL_SCORING.IMPORT_PARENT_DECAY,
        ),
        0,
        appendEvidence(parent.evidence, 'RELATED_IMPORT', parent.path),
      );
    };

    for (const parent of importParents) {
      for (const importPath of importedPaths(parent)) {
        await visitImport(parent, importPath);
      }
    }

    if (!testPrimary) {
      const anchorStems = new Set(
        [...scoredFiles.values()]
          .filter(({ path }) => !isTestSourcePath(path))
          .slice(0, 6)
          .map(
            ({ path }) =>
              path
                .split('/')
                .at(-1)
                ?.replace(/\.[^.]+$/u, '') ?? path,
          ),
      );
      for (const candidatePath of normalizedPaths) {
        if (!isTestSourcePath(candidatePath) || scoredFiles.has(candidatePath)) continue;
        const matchedAnchor = [...anchorStems].find((anchor) =>
          isTestCounterpart(candidatePath, anchor),
        );
        if (matchedAnchor === undefined) continue;
        await readFile(
          candidatePath,
          pathScoreByPath.get(candidatePath) ?? CONTEXT_RETRIEVAL_SCORING.TEST_FILENAME_AFFINITY,
          0,
          appendEvidence([], 'NEARBY_TEST', matchedAnchor),
        );
      }
    }

    const files = [...scoredFiles.values()]
      .sort((left, right) => compareScoredFiles(left, right, testPrimary))
      .map((file) => {
        const owner = owningModule(file.path, allModules);
        return {
          path: file.path,
          content: file.content,
          priority: 'RELATED_SOURCE_FILES' as const,
          selectionEvidence: file.evidence,
          ...(owner === undefined ? {} : { modulePath: owner.path }),
        };
      });

    return { files, omissions, reads };
  }

  taskCorpus(currentTask: ProjectTask, relatedTasks: readonly ProjectTask[]): string {
    return [taskText(currentTask), ...relatedTasks.map(taskText)].join(' ');
  }
}
