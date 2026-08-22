import type { ControlledGitService } from '../../controlled-git/controlled-git.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface CommitGitSnapshotToolDeps {
  readonly controlledGit: ControlledGitService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'commit_git_snapshot',
  name: 'Commit Git snapshot',
  description:
    'Create a local Git commit for staged paths bound to a successful FileApply (ADR-041). Requires OPERATOR approval. Never pushes.',
  inputSchema: {
    type: 'object',
    required: ['preparationId'],
    properties: {
      preparationId: { type: 'string' },
      commitMessage: { type: 'string' },
      expectedBranch: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      executionStatus: { type: 'string' },
      commitHash: { type: 'string' },
    },
  },
  capabilityClass: 'GIT_WRITE',
  readOnly: true,
  riskLevel: 'HIGH',
  authorizationAction: 'GIT_WRITE',
  requiresGate2: false,
  approvalRequirement: 'OPERATOR',
  workspaceScoped: true,
  timeoutMs: 30_000,
  supportsCancellation: true,
  evidencePolicy: 'DIGEST',
  auditPolicy: 'DIGEST',
  allowedPhases: ['VERIFYING', 'COMPLETED', 'CORRECTING'],
};

export function createCommitGitSnapshotTool(deps: CommitGitSnapshotToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Git commit cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return {
          summary: 'Invalid arguments.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'Expected object with preparationId.',
        };
      }
      const record = args as Record<string, unknown>;
      for (const forbidden of [
        'command',
        'argv',
        'shell',
        'cwd',
        'env',
        'gitArgs',
        '-c',
        '--config',
        'amend',
        'all',
        'push',
      ]) {
        if (forbidden in record) {
          return {
            summary: 'Forbidden Git argument field.',
            errorCode: 'FORBIDDEN_ARGUMENT',
            errorMessage: `Field "${forbidden}" is not allowed.`,
          };
        }
      }

      const preparationId =
        typeof record.preparationId === 'string' ? record.preparationId.trim() : '';
      const commitMessage =
        typeof record.commitMessage === 'string' ? record.commitMessage : undefined;
      const expectedBranch =
        typeof record.expectedBranch === 'string' ? record.expectedBranch : undefined;

      const result = await deps.controlledGit.commitSnapshot({
        projectId: context.projectId,
        repositoryRoot: context.projectRoot,
        preparationId,
        operatorApproved: context.securityEvidence.operatorApproved,
        commitMessage,
        expectedBranch,
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
        ...(result.commitHash !== undefined ? { commitHash: result.commitHash } : {}),
      };

      if (result.executionStatus !== 'SUCCEEDED') {
        return {
          summary: `Git commit ${result.executionStatus}.`,
          structured,
          errorCode: result.policyBlockCode ?? result.executionStatus,
          errorMessage: result.diagnosticSummary,
        };
      }
      return {
        summary: `Created local Git commit ${result.commitHash ?? ''}.`.trim(),
        structured,
      };
    },
  };
}
