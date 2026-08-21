import { RelatedFilesService } from '../../codebase-intelligence/related-files.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface FindRelatedFilesToolDeps {
  readonly listSourcePaths: () => Promise<readonly string[]>;
  readonly readSourceFile: (logicalPath: string) => Promise<string>;
  readonly relatedFiles?: RelatedFilesService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'find_related_files',
  name: 'Find related files',
  description:
    'Find bounded related imports, test counterparts, and nearby files for an anchor path. Read-only.',
  inputSchema: {
    type: 'object',
    required: ['logicalPath'],
    properties: {
      logicalPath: { type: 'string' },
      goal: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      anchorPath: { type: 'string' },
      related: { type: 'array' },
      truncated: { type: 'boolean' },
    },
  },
  capabilityClass: 'SEARCH',
  readOnly: true,
  riskLevel: 'LOW',
  authorizationAction: 'INVESTIGATE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 20_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'PLANNING', 'DIAGNOSING', 'CORRECTING'],
};

export function createFindRelatedFilesTool(deps: FindRelatedFilesToolDeps): ToolHandler {
  const relatedFiles = deps.relatedFiles ?? new RelatedFilesService();

  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Related-file search cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const logicalPath = parsePath(args, 'logicalPath');
      if (logicalPath === undefined) {
        return {
          summary: 'Invalid logicalPath.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'logicalPath is required.',
        };
      }

      const goal =
        typeof args === 'object' &&
        args !== null &&
        !Array.isArray(args) &&
        typeof (args as Record<string, unknown>).goal === 'string'
          ? ((args as Record<string, unknown>).goal as string)
          : undefined;

      const sourcePaths = await deps.listSourcePaths();
      const result = await relatedFiles.findRelated({
        anchorPath: logicalPath,
        sourcePaths,
        readFile: deps.readSourceFile,
        requestText: goal,
      });

      const structured: ToolJsonValue = {
        anchorPath: result.anchorPath,
        related: result.related.map((entry) => ({
          logicalPath: entry.logicalPath,
          relation: entry.relation,
          score: entry.score,
        })),
        truncated: result.truncated,
      };

      return {
        summary: `Found ${result.related.length} related file(s) for ${result.anchorPath}.`,
        structured,
      };
    },
  };
}

function parsePath(args: unknown, key: string): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>)[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\\/g, '/');
  if (trimmed.length === 0 || trimmed.includes('..') || trimmed.startsWith('/')) return undefined;
  return trimmed;
}

export function findRelatedFilesToolDefinition(): ToolDefinition {
  return DEFINITION;
}
