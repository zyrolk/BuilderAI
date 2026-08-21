import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';
import {
  DEFAULT_INVESTIGATION_CONFIGURATION,
  INVESTIGATION_BOUNDED_MESSAGE,
  INVESTIGATION_PROTECTED_SKIPPED_MESSAGE,
  type InvestigationConfiguration,
} from './investigation-configuration';
import { selectInventoryByRelevance } from '../codebase-intelligence/inventory-selection';
import { rankSearchMatches } from './investigation-path-ranking';
import type { RepositorySearchMatch, RepositorySearchResult } from './investigation.types';

const TEXTUAL_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.yaml',
  '.yml',
  '.sql',
  '.graphql',
  '.rules',
  '.vue',
  '.svelte',
]);

function isTextualSourcePath(logicalPath: string): boolean {
  const lower = logicalPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXTUAL_EXTENSIONS.has(lower.slice(dot));
}

function containsBinaryNull(content: string): boolean {
  return content.includes('\u0000');
}

function buildExcerpt(
  lines: readonly string[],
  lineIndex: number,
  contextLines: number,
  maximumCharacters: number,
): string {
  const start = Math.max(0, lineIndex - contextLines);
  const end = Math.min(lines.length - 1, lineIndex + contextLines);
  const excerpt = lines.slice(start, end + 1).join('\n');
  if (excerpt.length <= maximumCharacters) return excerpt;
  return `${excerpt.slice(0, maximumCharacters)}…`;
}

function lineMatchesQuery(line: string, query: string): boolean {
  return line.toLowerCase().includes(query.toLowerCase());
}

export class RepositorySearchService {
  constructor(
    private readonly configuration: InvestigationConfiguration = DEFAULT_INVESTIGATION_CONFIGURATION,
    private readonly pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
  ) {}

  async search(
    sourcePaths: readonly string[],
    queries: readonly string[],
    readFile: (logicalPath: string) => Promise<string>,
    requestText = '',
  ): Promise<RepositorySearchResult> {
    const limitationMessages: string[] = [];
    const eligiblePaths = sourcePaths
      .filter((path) => isScopeEligiblePath(path, this.pathProtection) && isTextualSourcePath(path))
      .sort((left, right) => left.localeCompare(right));

    if (eligiblePaths.length < sourcePaths.length) {
      limitationMessages.push(INVESTIGATION_PROTECTED_SKIPPED_MESSAGE);
    }

    const inventory = selectInventoryByRelevance(
      eligiblePaths,
      { requestText, queries },
      {
        maximumContentScanPaths: this.configuration.maximumFilesScanned,
        maximumRankedInventory: this.configuration.maximumCandidatePaths,
      },
    );
    const rankingContext = inventory.rankingContext;
    const pathsToScan = inventory.contentScanPaths;
    let truncated = inventory.truncated;
    const candidateMatches: RepositorySearchMatch[] = [];

    for (const logicalPath of pathsToScan) {
      let fileMatchCount = 0;
      let content: string;
      try {
        content = await readFile(logicalPath);
      } catch {
        continue;
      }
      if (containsBinaryNull(content)) continue;

      const lines = content.replace(/\r\n?/g, '\n').split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (fileMatchCount >= this.configuration.maximumMatchesPerFile) {
          truncated = true;
          break;
        }
        const lineText = lines[lineIndex] ?? '';
        for (const query of queries) {
          if (!lineMatchesQuery(lineText, query)) continue;
          candidateMatches.push({
            logicalPath,
            lineNumber: lineIndex + 1,
            lineText,
            query,
            excerpt: buildExcerpt(
              lines,
              lineIndex,
              this.configuration.contextLinesAroundMatch,
              this.configuration.maximumExcerptCharacters,
            ),
          });
          fileMatchCount += 1;
          break;
        }
      }
    }

    const rankedMatches = rankSearchMatches(
      candidateMatches,
      rankingContext,
      this.configuration.maximumMatches,
    );
    if (candidateMatches.length > rankedMatches.length) truncated = true;
    if (truncated) limitationMessages.push(INVESTIGATION_BOUNDED_MESSAGE);

    return {
      queries,
      matches: rankedMatches,
      filesScanned: pathsToScan.length,
      truncated,
      limitationMessages,
    };
  }
}
