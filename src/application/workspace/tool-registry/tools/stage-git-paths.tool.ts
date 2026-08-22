import type { ControlledGitService } from '../../controlled-git/controlled-git.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface StageGitPathsToolDeps {
  readonly controlledGit: ControlledGitService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'stage_git_paths',
  name: 'Stage Git paths',
  description:
    'Stage allowlisted paths that are a subset of the bound successful FileApply paths (ADR-041). Requires OPERATOR approval.',
  inputSchema: {
    type: 'object',
    required: ['preparationId', 'paths'],
    properties: {
      preparationId: { type: 'string' },
      paths: { type: 'array', items: { type: 'string' } },
      expectedBranch: { type: 'string' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      executionStatus: { type: 'string' },
      stagedPaths: { type: 'array' },
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

export function createStageGitPathsTool(deps: StageGitPathsToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Git stage cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      if (args === null || typeof args !== 'object' || Array.isArray(args)) {
        return {
          summary: 'Invalid arguments.',
          errorCode: 'INVALID_ARGS',
          errorMessage: 'Expected object with preparationId and paths.',
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
      const paths = Array.isArray(record.paths)
        ? record.paths.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const expectedBranch =
        typeof record.expectedBranch === 'string' ? record.expectedBranch : undefined;

      const result = await deps.controlledGit.stagePaths({
        projectId: context.projectId,
        repositoryRoot: context.projectRoot,
        preparationId,
        requestedPaths: paths,
        operatorApproved: context.securityEvidence.operatorApproved,
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
        stagedPaths: result.stagedPaths ?? [],
      };

      if (result.executionStatus !== 'SUCCEEDED') {
        return {
          summary: `Git stage ${result.executionStatus}.`,
          structured,
          errorCode: result.policyBlockCode ?? result.executionStatus,
          errorMessage: result.diagnosticSummary,
        };
      }
      return { summary: `Staged ${String(result.stagedPaths?.length ?? 0)} path(s).`, structured };
    },
  };
}
