import type { ExternalTargetReadiness } from '../../external-target-readiness/external-target-readiness.types';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectReadinessToolDeps {
  readonly project: (input: { readonly projectRoot: string }) => Promise<ExternalTargetReadiness>;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_readiness',
  name: 'Inspect readiness',
  description:
    'Read-only external-target readiness projection (status, blockers, verification capability flags).',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  outputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      projectId: { type: 'string' },
      runtimeConnected: { type: 'boolean' },
      indexedFileCount: { type: 'number' },
      verification: { type: 'object' },
      blockerCodes: { type: 'array' },
      warningCodes: { type: 'array' },
    },
  },
  capabilityClass: 'INSPECT',
  readOnly: true,
  riskLevel: 'LOW',
  authorizationAction: 'READINESS',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 20_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'PLANNING', 'DIAGNOSING', 'CORRECTING', 'FAILED'],
};

export function createInspectReadinessTool(deps: InspectReadinessToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(_args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Readiness inspect cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const projectRoot = context.projectRoot.trim();
      if (projectRoot.length === 0) {
        return {
          summary: 'Missing projectRoot in tool context.',
          errorCode: 'INVALID_CONTEXT',
          errorMessage: 'projectRoot is required for inspect_readiness.',
        };
      }

      const readiness = await deps.project({ projectRoot });
      if (context.cancellation.cancelled) {
        return {
          summary: 'Readiness inspect cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }

      const structured: ToolJsonValue = {
        status: readiness.status,
        projectId: readiness.projectId,
        projectName: readiness.projectName,
        runtimeConnected: readiness.runtimeConnected,
        indexedFileCount: readiness.indexedFileCount,
        sourceRootCount: readiness.sourceRoots.length,
        testRootCount: readiness.testRoots.length,
        protectedAreaCount: readiness.protectedAreas.length,
        verification: {
          build: readiness.verification.build,
          test: readiness.verification.test,
          lint: readiness.verification.lint,
          typecheck: readiness.verification.typecheck,
          format: readiness.verification.format,
          devServer: readiness.verification.devServer,
          browserVerification: readiness.verification.browserVerification,
        },
        blockerCodes: readiness.blockers.map((issue) => issue.code),
        warningCodes: readiness.warnings.map((issue) => issue.code),
        blockerCount: readiness.blockers.length,
        warningCount: readiness.warnings.length,
      };

      return {
        summary: `Readiness status ${readiness.status} (${readiness.blockers.length} blocker(s), ${readiness.warnings.length} warning(s)).`,
        structured,
      };
    },
  };
}

export function inspectReadinessToolDefinition(): ToolDefinition {
  return DEFINITION;
}
