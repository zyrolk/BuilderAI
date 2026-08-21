import { ProjectFileSourceAccessDeniedError } from '../../../../core/context-builder';
import { buildFileOutline } from '../../codebase-intelligence/file-outline.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectFileOutlineToolDeps {
  readonly readSourceFile: (logicalPath: string) => Promise<string>;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_file_outline',
  name: 'Inspect file outline',
  description:
    'Deterministic regex-based outline of exports/classes/functions/interfaces (names + line numbers). No AST/LSP.',
  inputSchema: {
    type: 'object',
    required: ['logicalPath'],
    properties: {
      logicalPath: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      logicalPath: { type: 'string' },
      entries: { type: 'array' },
      truncated: { type: 'boolean' },
    },
  },
  capabilityClass: 'INSPECT',
  readOnly: true,
  riskLevel: 'LOW',
  authorizationAction: 'INVESTIGATE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 15_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'PLANNING', 'DIAGNOSING', 'CORRECTING'],
};

export function createInspectFileOutlineTool(deps: InspectFileOutlineToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Outline cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const logicalPath = parsePath(args);
      if (logicalPath === undefined) {
        return {
          summary: 'Invalid logicalPath.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'logicalPath is required.',
        };
      }

      try {
        const content = await deps.readSourceFile(logicalPath);
        const outline = buildFileOutline({ logicalPath, content });
        const structured: ToolJsonValue = {
          logicalPath: outline.logicalPath,
          entries: outline.entries.map((entry) => ({
            kind: entry.kind,
            name: entry.name,
            lineNumber: entry.lineNumber,
          })),
          truncated: outline.truncated,
          scannedCharacters: outline.scannedCharacters,
        };
        return {
          summary: `Outline of ${logicalPath}: ${outline.entries.length} entr${outline.entries.length === 1 ? 'y' : 'ies'}.`,
          structured,
        };
      } catch (error) {
        if (error instanceof ProjectFileSourceAccessDeniedError) {
          return {
            summary: 'Source file access denied by confidentiality policy.',
            errorCode: 'ACCESS_DENIED',
            errorMessage: 'Source file access was denied by the workspace confidentiality policy.',
          };
        }
        const message = error instanceof Error ? error.message.slice(0, 200) : 'Outline failed.';
        return {
          summary: 'Failed to inspect file outline.',
          errorCode: 'OUTLINE_FAILED',
          errorMessage: message,
        };
      }
    },
  };
}

function parsePath(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>).logicalPath;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\\/g, '/');
  if (trimmed.length === 0 || trimmed.includes('..') || trimmed.startsWith('/')) return undefined;
  return trimmed;
}

export function inspectFileOutlineToolDefinition(): ToolDefinition {
  return DEFINITION;
}
