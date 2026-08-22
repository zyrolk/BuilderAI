import type { ControlledTerminalService } from '../../controlled-terminal/controlled-terminal.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectVerificationCatalogToolDeps {
  readonly controlledTerminal: ControlledTerminalService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_verification_catalog',
  name: 'Inspect verification catalog',
  description:
    'List catalog-only controlled terminal command ids available for this workspace (no spawn).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  outputSchema: {
    type: 'object',
    properties: {
      entries: { type: 'array' },
      availableCount: { type: 'number' },
      totalCount: { type: 'number' },
    },
  },
  capabilityClass: 'INSPECT',
  readOnly: true,
  riskLevel: 'LOW',
  authorizationAction: 'READINESS',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 10_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'PLANNING', 'VERIFYING', 'DIAGNOSING', 'CORRECTING', 'FAILED'],
};

export function createInspectVerificationCatalogTool(
  deps: InspectVerificationCatalogToolDeps,
): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(_args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Catalog inspect cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const projectRoot = context.projectRoot.trim();
      if (projectRoot.length === 0) {
        return {
          summary: 'Missing projectRoot in tool context.',
          errorCode: 'INVALID_CONTEXT',
          errorMessage: 'projectRoot is required for inspect_verification_catalog.',
        };
      }

      const entries = deps.controlledTerminal.listCatalog(projectRoot);
      const structured: ToolJsonValue = {
        entries: entries.map((entry) => ({
          commandId: entry.commandId,
          available: entry.available,
          ...(entry.scriptName !== undefined ? { scriptName: entry.scriptName } : {}),
          stage: entry.stage,
          description: entry.description,
        })),
        availableCount: entries.filter((entry) => entry.available).length,
        totalCount: entries.length,
      };

      return {
        summary: `Verification catalog: ${String(entries.filter((e) => e.available).length)}/${String(entries.length)} available.`,
        structured,
      };
    },
  };
}

export function inspectVerificationCatalogToolDefinition(): ToolDefinition {
  return DEFINITION;
}
