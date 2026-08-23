import {
  ControlledLocalBrowserError,
  type ControlledLocalBrowserService,
} from '../../controlled-local-browser/controlled-local-browser.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface RunLocalBrowserObservationToolDeps {
  readonly controlledBrowser: ControlledLocalBrowserService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'run_local_browser_observation',
  name: 'Run local browser observation',
  description:
    'OPERATOR-approved localhost-only observation of catalogued relative routes (no absolute URLs).',
  inputSchema: {
    type: 'object',
    properties: {
      routeIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['routeIds'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      routeIds: { type: 'array' },
      routes: { type: 'array' },
      diagnosticSummary: { type: 'string' },
    },
  },
  capabilityClass: 'BROWSER',
  readOnly: true,
  riskLevel: 'HIGH',
  authorizationAction: 'BROWSER_OBSERVE',
  requiresGate2: false,
  approvalRequirement: 'OPERATOR',
  workspaceScoped: true,
  timeoutMs: 120_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['VERIFYING', 'DIAGNOSING'],
};

export function createRunLocalBrowserObservationTool(
  deps: RunLocalBrowserObservationToolDeps,
): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Browser observation cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      try {
        deps.controlledBrowser.assertSafeObservationArgs(args);
        const routeIds = (args as { routeIds: string[] }).routeIds;
        const result = await deps.controlledBrowser.observe({
          projectId: context.projectId,
          projectRoot: context.projectRoot,
          routeIds,
          cancellation: context.cancellation,
          browserObservationApproved: context.securityEvidence.browserObservationApproved === true,
          leaseId: `${context.runId}:browser`,
        });
        const structured: ToolJsonValue = {
          status: result.status,
          routeIds: [...result.routeIds],
          routes: result.routes.map((route) => ({
            routeId: route.routeId,
            path: route.path,
            status: route.status,
            ...(route.httpStatus !== undefined ? { httpStatus: route.httpStatus } : {}),
            ...(route.titleSummary !== undefined ? { titleSummary: route.titleSummary } : {}),
            ...(route.titleDigest !== undefined ? { titleDigest: route.titleDigest } : {}),
            consoleErrorCount: route.consoleErrorCount,
            consoleWarningCount: route.consoleWarningCount,
            networkFailureCount: route.networkFailureCount,
            ...(route.screenshotArtifactRef !== undefined
              ? { screenshotArtifactRef: route.screenshotArtifactRef }
              : {}),
            ...(route.screenshotDigest !== undefined
              ? { screenshotDigest: route.screenshotDigest }
              : {}),
            ...(route.finalUrlRedacted !== undefined
              ? { finalUrlRedacted: route.finalUrlRedacted }
              : {}),
          })),
          durationMs: result.durationMs,
          diagnosticSummary: result.diagnosticSummary,
          ...(result.policyBlockCode !== undefined
            ? { policyBlockCode: result.policyBlockCode }
            : {}),
        };
        if (
          result.status === 'CANCELLED' ||
          result.status === 'TIMEOUT' ||
          result.status === 'POLICY_BLOCKED' ||
          result.status === 'UNAVAILABLE' ||
          result.status === 'REJECTED_BY_POLICY'
        ) {
          return {
            summary: result.diagnosticSummary,
            structured,
            errorCode: result.policyBlockCode ?? result.status,
            errorMessage: result.diagnosticSummary,
          };
        }
        return {
          summary: result.diagnosticSummary,
          structured,
        };
      } catch (error: unknown) {
        if (error instanceof ControlledLocalBrowserError) {
          return {
            summary: error.message,
            errorCode: error.code,
            errorMessage: error.message,
          };
        }
        throw error;
      }
    },
  };
}
