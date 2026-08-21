import { ProjectFileSourceAccessDeniedError } from '../../../../core/context-builder';
import { inspectRelativeImports } from '../../codebase-intelligence/import-inspection';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectImportsToolDeps {
  readonly listSourcePaths: () => Promise<readonly string[]>;
  readonly readSourceFile: (logicalPath: string) => Promise<string>;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_imports',
  name: 'Inspect imports',
  description:
    'Inspect import/export specifiers and resolve relative paths within the workspace catalog. Read-only.',
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
      fromPath: { type: 'string' },
      imports: { type: 'array' },
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

export function createInspectImportsTool(deps: InspectImportsToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Import inspection cancelled.',
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
        const sourcePaths = await deps.listSourcePaths();
        const result = inspectRelativeImports({
          fromPath: logicalPath,
          content,
          sourcePaths,
        });
        const structured: ToolJsonValue = {
          fromPath: result.fromPath,
          imports: result.imports.map((entry) => ({
            specifier: entry.specifier,
            relative: entry.relative,
            resolvedPath: entry.resolvedPath ?? null,
          })),
          truncated: result.truncated,
        };
        return {
          summary: `Inspected ${result.imports.length} import(s) in ${result.fromPath}.`,
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
        const message =
          error instanceof Error ? error.message.slice(0, 200) : 'Import inspect failed.';
        return {
          summary: 'Failed to inspect imports.',
          errorCode: 'IMPORT_INSPECT_FAILED',
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

export function inspectImportsToolDefinition(): ToolDefinition {
  return DEFINITION;
}
