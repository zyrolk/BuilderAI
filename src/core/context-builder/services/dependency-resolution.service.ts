import type { ModuleAnalysis } from '../../blueprint-reader';
import type { ProjectBrain, ProjectTask } from '../../project-brain';
import {
  directoryName,
  normalizeProjectPath,
  pathBelongsToModule,
  resolveRelativePath,
} from '../internal/path';
import { relevanceScore } from '../internal/text-relevance';
import type { ProjectFileSource } from '../ports';
import type { ContextOmission, ContextSourceFile, ProjectSourceFile } from '../types';
import { ContextBuilderValidationError } from '../types';

const IMPORT_PATTERN = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const SOURCE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx'];

export interface FileResolution {
  readonly files: readonly ContextSourceFile[];
  readonly omissions: readonly ContextOmission[];
  readonly reads: number;
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
    query: ReadonlySet<string>,
    relevantModules: readonly ModuleAnalysis[],
    allModules: readonly ModuleAnalysis[],
    maxReads: number,
  ): Promise<FileResolution> {
    const normalizedPaths = sourcePaths.map(normalizeProjectPath).sort();
    const availablePaths = new Set(normalizedPaths);
    const score = (sourcePath: string): number => relevanceScore(query, sourcePath);
    const seeds = normalizedPaths
      .filter(
        (sourcePath) =>
          relevantModules.some((moduleRecord) =>
            pathBelongsToModule(sourcePath, moduleRecord.path),
          ) || score(sourcePath) >= 2,
      )
      .sort((left, right) => score(right) - score(left) || left.localeCompare(right));

    const selected: ProjectSourceFile[] = [];
    const omissions: ContextOmission[] = [];
    const omitted = new Set<string>();
    const visited = new Set<string>();
    const visit = async (sourcePath: string): Promise<void> => {
      if (visited.has(sourcePath)) return;
      visited.add(sourcePath);
      if (selected.length >= maxReads) {
        if (!omitted.has(sourcePath)) {
          omissions.push({ kind: 'FILE', identifier: sourcePath, reason: 'FILE_LIMIT' });
          omitted.add(sourcePath);
        }
        return;
      }

      let content: string;
      try {
        content = await source.readSourceFile(sourcePath);
      } catch (error: unknown) {
        throw new ContextBuilderValidationError([
          {
            code: 'INVALID_REFERENCE',
            path: '$.sourceFileSource',
            message: `Could not read '${sourcePath}': ${error instanceof Error ? error.message : 'unknown error'}`,
          },
        ]);
      }
      const file = { path: sourcePath, content };
      selected.push(file);
      for (const importPath of importedPaths(file)) {
        const dependencyPath = findImportedPath(importPath, availablePaths);
        if (dependencyPath === undefined) {
          throw new ContextBuilderValidationError([
            {
              code: 'INVALID_REFERENCE',
              path: '$.sourceFileSource',
              message: `Source file '${sourcePath}' references unavailable relative import '${importPath}'`,
            },
          ]);
        }
        await visit(dependencyPath);
      }
    };
    for (const seed of seeds) await visit(seed);

    return {
      files: selected.map((file) => {
        const owner = owningModule(file.path, allModules);
        return {
          ...file,
          priority: 'RELATED_SOURCE_FILES',
          ...(owner === undefined ? {} : { modulePath: owner.path }),
        };
      }),
      omissions,
      reads: selected.length,
    };
  }

  taskCorpus(currentTask: ProjectTask, relatedTasks: readonly ProjectTask[]): string {
    return [taskText(currentTask), ...relatedTasks.map(taskText)].join(' ');
  }
}
