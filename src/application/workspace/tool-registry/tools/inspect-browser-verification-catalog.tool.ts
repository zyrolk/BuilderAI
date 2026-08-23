import type {
  ControlledLocalBrowserService,
  ControlledLocalBrowserError,
} from '../../controlled-local-browser/controlled-local-browser.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectBrowserVerificationCatalogToolDeps {
  readonly controlledBrowser: ControlledLocalBrowserService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_browser_verification_catalog',
  name: 'Inspect browser verification catalog',
  description:
    'List server-owned localhost browser observation route ids and limits (no navigation).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  outputSchema: {
    type: 'object',
    properties: {
      routes: { type: 'array' },
      maximumRoutesPerObservation: { type: 'number' },
      maximumScreenshots: { type: 'number' },
      localhostOnly: { type: 'boolean' },
    },
  },
  capabilityClass: 'BROWSER',
  readOnly: true,
  riskLevel: 'LOW',
  authorizationAction: 'INVESTIGATE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 10_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['VERIFYING', 'DIAGNOSING'],
};

export function createInspectBrowserVerificationCatalogTool(
  deps: InspectBrowserVerificationCatalogToolDeps,
): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(_args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Browser catalog inspect cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      const catalog = deps.controlledBrowser.listCatalog();
      const structured: ToolJsonValue = {
        routes: catalog.routes.map((route) => ({
          routeId: route.routeId,
          path: route.path,
        })),
        maximumRoutesPerObservation: catalog.maximumRoutesPerObservation,
        maximumScreenshots: catalog.maximumScreenshots,
        workflowDeadlineMs: catalog.workflowDeadlineMs,
        localhostOnly: catalog.localhostOnly,
        acceptsAbsoluteUrls: catalog.acceptsAbsoluteUrls,
        acceptsModelCredentials: catalog.acceptsModelCredentials,
        pageEvaluateAvailable: catalog.pageEvaluateAvailable,
        downloadsAllowed: catalog.downloadsAllowed,
        mcpEnabled: catalog.mcpEnabled,
        openWebEnabled: catalog.openWebEnabled,
      };
      return {
        summary: `Browser observation catalog: ${catalog.routes.length} route(s).`,
        structured,
      };
    },
  };
}

// Re-export type for tests that assert error shape without importing service.
export type { ControlledLocalBrowserError };
