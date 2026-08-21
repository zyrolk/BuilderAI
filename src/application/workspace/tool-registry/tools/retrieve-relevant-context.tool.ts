import { RelevantContextService } from '../../codebase-intelligence/relevant-context.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface RetrieveRelevantContextToolDeps {
  readonly listSourcePaths: () => Promise<readonly string[]>;
  readonly readSourceFile: (logicalPath: string) => Promise<string>;
  readonly relevantContext?: RelevantContextService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'retrieve_relevant_context',
  name: 'Retrieve relevant context',
  description:
    'Retrieve a bounded set of high-relevance source previews for a goal. Read-only; hard file/character caps.',
  inputSchema: {
    type: 'object',
    required: ['goal'],
    properties: {
      goal: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      files: { type: 'array' },
      reads: { type: 'number' },
      truncated: { type: 'boolean' },
      structuredDigest: { type: 'string' },
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

export function createRetrieveRelevantContextTool(
  deps: RetrieveRelevantContextToolDeps,
): ToolHandler {
  const relevantContext = deps.relevantContext ?? new RelevantContextService();

  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Relevant context retrieval cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const goal = parseGoal(args);
      if (goal === undefined) {
        return {
          summary: 'Invalid goal.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'goal must be a non-empty string.',
        };
      }

      const sourcePaths = await deps.listSourcePaths();
      if (context.cancellation.cancelled) {
        return {
          summary: 'Relevant context retrieval cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const result = await relevantContext.retrieve({
        goal,
        sourcePaths,
        readFile: deps.readSourceFile,
      });

      const structured: ToolJsonValue = {
        goal: result.goal,
        files: result.files.map((file) => ({
          logicalPath: file.logicalPath,
          pathScore: file.pathScore,
          preview: file.preview,
          truncated: file.truncated,
          contentDigest: file.contentDigest,
        })),
        filesConsidered: result.filesConsidered,
        reads: result.reads,
        truncated: result.truncated,
        structuredDigest: result.structuredDigest,
      };

      return {
        summary: `Retrieved ${result.files.length} relevant file(s) (${result.reads} read(s)).`,
        structured,
      };
    },
  };
}

function parseGoal(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>).goal;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 4_000) return undefined;
  return trimmed;
}

export function retrieveRelevantContextToolDefinition(): ToolDefinition {
  return DEFINITION;
}
