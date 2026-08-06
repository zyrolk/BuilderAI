import { isScopeEligiblePath } from '../../../core/update-scope/internal/protected-scope-paths';
import {
  DEFAULT_INVESTIGATION_CONFIGURATION,
  INVESTIGATION_BOUNDED_MESSAGE,
  INVESTIGATION_PROTECTED_SKIPPED_MESSAGE,
  type InvestigationConfiguration,
} from './investigation-configuration';
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
  ) {}

  async search(
    sourcePaths: readonly string[],
    queries: readonly string[],
    readFile: (logicalPath: string) => Promise<string>,
  ): Promise<RepositorySearchResult> {
    const limitationMessages: string[] = [];
    const eligiblePaths = sourcePaths
      .filter((path) => isScopeEligiblePath(path) && isTextualSourcePath(path))
      .sort((left, right) => left.localeCompare(right));

    if (eligiblePaths.length < sourcePaths.length) {
      limitationMessages.push(INVESTIGATION_PROTECTED_SKIPPED_MESSAGE);
    }

    const pathsToScan = eligiblePaths.slice(0, this.configuration.maximumFilesScanned);
    let truncated = eligiblePaths.length > pathsToScan.length;
    const matches: RepositorySearchMatch[] = [];

    for (const logicalPath of pathsToScan) {
      if (matches.length >= this.configuration.maximumMatches) {
        truncated = true;
        break;
      }
      let content: string;
      try {
        content = await readFile(logicalPath);
      } catch {
        continue;
      }
      if (containsBinaryNull(content)) continue;

      const lines = content.replace(/\r\n?/g, '\n').split('\n');
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (matches.length >= this.configuration.maximumMatches) {
          truncated = true;
          break;
        }
        const lineText = lines[lineIndex] ?? '';
        for (const query of queries) {
          if (!lineMatchesQuery(lineText, query)) continue;
          matches.push({
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
          break;
        }
      }
    }

    if (truncated) limitationMessages.push(INVESTIGATION_BOUNDED_MESSAGE);

    return {
      queries,
      matches: matches.sort((left, right) =>
        left.logicalPath === right.logicalPath
          ? left.lineNumber - right.lineNumber
          : left.logicalPath.localeCompare(right.logicalPath),
      ),
      filesScanned: pathsToScan.length,
      truncated,
      limitationMessages,
    };
  }
}
