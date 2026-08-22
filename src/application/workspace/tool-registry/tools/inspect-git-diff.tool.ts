import type { ControlledGitService } from '../../controlled-git/controlled-git.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectGitDiffToolDeps {
  readonly controlledGit: ControlledGitService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_git_diff',
  name: 'Inspect Git diff',
  description: 'Read-only bounded Git diff --stat for the workspace repository (ADR-041).',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      executionStatus: { type: 'string' },
      outputDigest: { type: 'string' },
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
  evidencePolicy: 'DIGEST',
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

export function createInspectGitDiffTool(deps: InspectGitDiffToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(_args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Git diff cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      const result = await deps.controlledGit.inspectDiff({
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
      };
      if (result.executionStatus !== 'SUCCEEDED') {
        return {
          summary: `Git diff ${result.executionStatus}.`,
          structured,
          errorCode: result.policyBlockCode ?? result.executionStatus,
          errorMessage: result.diagnosticSummary,
        };
      }
      return { summary: 'Git diff inspected.', structured };
    },
  };
}
