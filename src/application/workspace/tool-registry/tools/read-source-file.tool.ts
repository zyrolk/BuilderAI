import { createHash } from 'node:crypto';

import { ProjectFileSourceAccessDeniedError } from '../../../../core/context-builder';
import {
  TOOL_EXCERPT_MAX_CHARS,
  type ToolDefinition,
  type ToolHandler,
  type ToolHandlerRawResult,
  type ToolJsonValue,
} from '../tool-registry.types';

export interface ReadSourceFileToolDeps {
  readonly readSourceFile: (logicalPath: string) => Promise<string>;
  readonly maximumCharacters?: number;
}

const DEFINITION: ToolDefinition = {
  toolId: 'read_source_file',
  name: 'Read source file',
  description:
    'Bounded read of a single workspace source file preview. Read-only; does not return full unbounded contents.',
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
      contentDigest: { type: 'string' },
      preview: { type: 'string' },
      truncated: { type: 'boolean' },
      characterCount: { type: 'number' },
    },
  },
  capabilityClass: 'READ',
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

export function createReadSourceFileTool(deps: ReadSourceFileToolDeps): ToolHandler {
  const maximumCharacters = deps.maximumCharacters ?? TOOL_EXCERPT_MAX_CHARS;

  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Read cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const logicalPath = parseLogicalPath(args);
      if (logicalPath === undefined) {
        return {
          summary: 'Invalid logicalPath.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'logicalPath must be a non-empty relative project path.',
        };
      }

      try {
        const content = await deps.readSourceFile(logicalPath);
        if (context.cancellation.cancelled) {
          return {
            summary: 'Read cancelled.',
            errorCode: 'CANCELLED',
            errorMessage: context.cancellation.reason ?? 'cancelled',
          };
        }

        const truncated = content.length > maximumCharacters;
        const preview = truncated ? `${content.slice(0, maximumCharacters - 1)}…` : content;
        const contentDigest = createHash('sha256')
          .update(content, 'utf8')
          .digest('hex')
          .slice(0, 16);

        const structured: ToolJsonValue = {
          logicalPath,
          contentDigest,
          preview,
          truncated,
          characterCount: content.length,
        };

        return {
          summary: truncated
            ? `Read preview of ${logicalPath} (truncated).`
            : `Read preview of ${logicalPath}.`,
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
        const message = error instanceof Error ? error.message.slice(0, 200) : 'Read failed.';
        return {
          summary: 'Failed to read source file.',
          errorCode: 'READ_FAILED',
          errorMessage: message,
        };
      }
    },
  };
}

function parseLogicalPath(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>).logicalPath;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\\/g, '/');
  if (trimmed.length === 0 || trimmed.length > 512) return undefined;
  if (trimmed.startsWith('/') || trimmed.includes('..') || trimmed.includes('\0')) return undefined;
  if (/^[a-zA-Z]:/.test(trimmed)) return undefined;
  return trimmed;
}

export function readSourceFileToolDefinition(): ToolDefinition {
  return DEFINITION;
}
