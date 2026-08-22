import type { ControlledGitService } from '../../controlled-git/controlled-git.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectGitStatusToolDeps {
  readonly controlledGit: ControlledGitService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_git_status',
  name: 'Inspect Git status',
  description: 'Read-only porcelain-aligned Git status for the workspace repository (ADR-041).',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      executionStatus: { type: 'string' },
      branch: { type: ['string', 'null'] },
      dirtyPathCount: { type: 'number' },
    },
  },
  capabilityClass: 'GIT_READ',
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
  allowedPhases: [
    'UNDERSTANDING',
    'PLANNING',
    'VERIFYING',
    'DIAGNOSING',
    'CORRECTING',
    'COMPLETED',
  ],
};

export function createInspectGitStatusTool(deps: InspectGitStatusToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(_args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Git status cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      const result = await deps.controlledGit.inspectStatus({
        projectId: context.projectId,
        repositoryRoot: context.projectRoot,
        cancellation: context.cancellation,
      });
      const structured: ToolJsonValue = {
        commandId: result.commandId,
        executionStatus: result.executionStatus,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        policyBlocked: result.policyBlocked,
        ...(result.policyBlockCode !== undefined
          ? { policyBlockCode: result.policyBlockCode }
          : {}),
        outputDigest: result.outputDigest,
        diagnosticSummary: result.diagnosticSummary,
        outputLimited: result.outputLimited,
        ...(result.structured ?? {}),
      };
      if (result.executionStatus !== 'SUCCEEDED') {
        return {
          summary: `Git status ${result.executionStatus}.`,
          structured,
          errorCode: result.policyBlockCode ?? result.executionStatus,
          errorMessage: result.diagnosticSummary,
        };
      }
      return { summary: 'Git status inspected.', structured };
    },
  };
}
