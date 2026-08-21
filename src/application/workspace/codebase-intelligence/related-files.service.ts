import {
  MAX_IMPORT_DEPENDENCIES_PER_HIT,
  MAX_IMPLEMENTATION_COUNTERPARTS_PER_HIT,
  findImplementationCounterpartPaths,
} from '../investigation/evidence-expansion.service';
import {
  buildInvestigationRankingContext,
  scorePathRelevance,
} from '../investigation/investigation-path-ranking';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';
import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import {
  isTestCounterpart,
  basenameStemForPath,
} from '../../../core/context-builder/internal/path-relevance';
import { inspectRelativeImports } from './import-inspection';

export const RELATED_FILES_MAX_RESULTS = 16 as const;

export type RelatedFileRelation =
  'IMPORT' | 'TEST_COUNTERPART' | 'IMPLEMENTATION_COUNTERPART' | 'NEARBY' | 'BASENAME';

export interface RelatedFileEntry {
  readonly logicalPath: string;
  readonly relation: RelatedFileRelation;
  readonly score: number;
}

export interface RelatedFilesResult {
  readonly anchorPath: string;
  readonly related: readonly RelatedFileEntry[];
  readonly truncated: boolean;
}

export interface RelatedFilesServiceInput {
  readonly anchorPath: string;
  readonly sourcePaths: readonly string[];
  readonly readFile: (logicalPath: string) => Promise<string>;
  readonly requestText?: string;
  readonly queries?: readonly string[];
  readonly maximumResults?: number;
}

/**
 * Bounded related-file discovery reusing evidence-expansion / ranking signals (ADR-038).
 */
export class RelatedFilesService {
  constructor(
    private readonly pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
  ) {}

  async findRelated(input: RelatedFilesServiceInput): Promise<RelatedFilesResult> {
    const anchorPath = normalizeProjectPath(input.anchorPath);
    const maximumResults = Math.min(
      input.maximumResults ?? RELATED_FILES_MAX_RESULTS,
      RELATED_FILES_MAX_RESULTS,
    );
    const eligible = input.sourcePaths.filter((path) =>
      isScopeEligiblePath(path, this.pathProtection),
    );
    const rankingContext = buildInvestigationRankingContext({
      requestText: input.requestText ?? anchorPath,
      queries: input.queries ?? [basenameStemForPath(anchorPath)],
    });

    const scored = new Map<string, RelatedFileEntry>();
    const add = (logicalPath: string, relation: RelatedFileRelation, boost: number): void => {
      const normalized = normalizeProjectPath(logicalPath);
      if (normalized === anchorPath) return;
      if (!isScopeEligiblePath(normalized, this.pathProtection)) return;
      const score = scorePathRelevance(normalized, rankingContext) + boost;
      const existing = scored.get(normalized);
      if (existing === undefined || score > existing.score) {
        scored.set(normalized, { logicalPath: normalized, relation, score });
      }
    };

    for (const counterpart of findImplementationCounterpartPaths(
      anchorPath,
      eligible,
      this.pathProtection,
    ).slice(0, MAX_IMPLEMENTATION_COUNTERPARTS_PER_HIT)) {
      add(counterpart, 'IMPLEMENTATION_COUNTERPART', 80);
    }

    const stem = basenameStemForPath(anchorPath);
    for (const candidate of eligible) {
      const normalized = normalizeProjectPath(candidate);
      if (normalized === anchorPath) continue;
      if (isTestCounterpart(normalized, stem)) {
        add(normalized, 'TEST_COUNTERPART', 70);
      }
    }

    let content: string | undefined;
    try {
      content = await input.readFile(anchorPath);
    } catch {
      content = undefined;
    }

    if (content !== undefined) {
      const imports = inspectRelativeImports({
        fromPath: anchorPath,
        content,
        sourcePaths: eligible,
        maximumImports: MAX_IMPORT_DEPENDENCIES_PER_HIT,
      });
      for (const entry of imports.imports) {
        if (entry.resolvedPath !== undefined) {
          add(entry.resolvedPath, 'IMPORT', 60);
        }
      }
    }

    const hitDir = directory(anchorPath);
    for (const candidate of eligible) {
      if (scored.size >= maximumResults * 3) break;
      const normalized = normalizeProjectPath(candidate);
      if (normalized === anchorPath) continue;
      if (
        normalized.startsWith(`${hitDir}/`) &&
        normalized.split('/').length <= hitDir.split('/').length + 2
      ) {
        add(normalized, 'NEARBY', 20);
      }
      if (stem.length >= 4 && basename(normalized).includes(stem)) {
        add(normalized, 'BASENAME', 25);
      }
    }

    const related = [...scored.values()]
      .sort(
        (left, right) =>
          right.score - left.score || left.logicalPath.localeCompare(right.logicalPath),
      )
      .slice(0, maximumResults);

    return {
      anchorPath,
      related,
      truncated: scored.size > related.length,
    };
  }
}

function directory(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}
