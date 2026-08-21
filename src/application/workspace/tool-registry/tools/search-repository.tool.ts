import { RepositorySearchService } from '../../investigation/repository-search.service';
import { extractSearchQueries } from '../../investigation/search-query-extraction';
import {
  TOOL_SEARCH_QUERY_MAX,
  TOOL_SEARCH_QUERY_MAX_CHARS,
  type ToolDefinition,
  type ToolHandler,
  type ToolHandlerRawResult,
  type ToolJsonValue,
} from '../tool-registry.types';

export interface SearchRepositoryToolDeps {
  readonly listSourcePaths: () => Promise<readonly string[]>;
  readonly readSourceFile: (logicalPath: string) => Promise<string>;
  readonly searchService?: RepositorySearchService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'search_repository',
  name: 'Search repository',
  description:
    'Bounded textual search over workspace source paths. Read-only; protected paths are skipped.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      queries: { type: 'array', items: { type: 'string' } },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      queries: { type: 'array' },
      matchCount: { type: 'number' },
      filesScanned: { type: 'number' },
      truncated: { type: 'boolean' },
      matches: { type: 'array' },
      limitations: { type: 'array' },
    },
  },
  capabilityClass: 'SEARCH',
  readOnly: true,
  riskLevel: 'LOW',
  authorizationAction: 'INVESTIGATE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 30_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'PLANNING', 'DIAGNOSING', 'CORRECTING'],
};

export function createSearchRepositoryTool(deps: SearchRepositoryToolDeps): ToolHandler {
  const searchService = deps.searchService ?? new RepositorySearchService();

  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Search cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const queries = parseSearchQueries(args);
      if (queries.length === 0) {
        return {
          summary: 'No valid search queries.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'Provide query or queries (non-empty strings).',
        };
      }

      const sourcePaths = await deps.listSourcePaths();
      if (context.cancellation.cancelled) {
        return {
          summary: 'Search cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const result = await searchService.search(
        sourcePaths,
        queries,
        deps.readSourceFile,
        queries.join(' '),
      );

      const matches = result.matches.slice(0, 24).map((match) => ({
        logicalPath: match.logicalPath,
        lineNumber: match.lineNumber,
        query: match.query,
        lineText: truncate(match.lineText, 200),
        excerpt: truncate(match.excerpt, 240),
      }));

      const structured: ToolJsonValue = {
        queries: result.queries,
        matchCount: result.matches.length,
        filesScanned: result.filesScanned,
        truncated: result.truncated,
        matches,
        limitations: result.limitationMessages,
      };

      return {
        summary: `Found ${result.matches.length} match(es) across ${result.filesScanned} file(s).`,
        structured,
      };
    },
  };
}

function parseSearchQueries(args: unknown): string[] {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return [];
  const record = args as Record<string, unknown>;
  const collected: string[] = [];

  if (typeof record.query === 'string' && record.query.trim().length > 0) {
    collected.push(...extractSearchQueries(record.query, TOOL_SEARCH_QUERY_MAX));
  }

  if (Array.isArray(record.queries)) {
    for (const entry of record.queries) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim().slice(0, TOOL_SEARCH_QUERY_MAX_CHARS);
      if (trimmed.length > 0) collected.push(trimmed);
    }
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const query of collected) {
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(query);
    if (unique.length >= TOOL_SEARCH_QUERY_MAX) break;
  }
  return unique;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function searchRepositoryToolDefinition(): ToolDefinition {
  return DEFINITION;
}
