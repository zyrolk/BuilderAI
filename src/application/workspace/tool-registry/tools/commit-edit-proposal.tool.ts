import { EditProposalError } from '../../edit-proposal/edit-proposal.types';
import type { EditProposalService } from '../../edit-proposal/edit-proposal.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface CommitEditProposalToolDeps {
  readonly editProposals: EditProposalService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'commit_edit_proposal',
  name: 'Commit edit proposal',
  description:
    'Convert the draft into a ChangePlan via ChangePlanner and store it for Gate 2. Does not apply or approve.',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      preparationId: { type: 'string' },
      expiresAt: { type: 'string' },
      operationCount: { type: 'number' },
      gate2Summary: { type: 'object' },
      changePlanDigest: { type: 'string' },
    },
  },
  capabilityClass: 'PLAN',
  readOnly: true,
  riskLevel: 'HIGH',
  authorizationAction: 'PREPARE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 60_000,
  supportsCancellation: true,
  evidencePolicy: 'DIGEST',
  auditPolicy: 'DIGEST',
  allowedPhases: ['PLANNING', 'CORRECTING'],
};

export function createCommitEditProposalTool(deps: CommitEditProposalToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(_args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Commit cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      try {
        const result = await deps.editProposals.commit(context.runId, context.projectId);
        const structured: ToolJsonValue = {
          preparationId: result.preparationId,
          expiresAt: result.expiresAt,
          operationCount: result.operationCount,
          contentDigest: result.contentDigest,
          gate2Summary: {
            operationCount: result.gate2Summary.operationCount,
            truncated: result.gate2Summary.truncated,
            totalCharacterCount: result.gate2Summary.totalCharacterCount,
          },
          changePlanDigest: result.changePlanDigest,
        };
        return {
          summary: `Committed proposal to preparation ${result.preparationId} (awaiting Gate 2).`,
          structured,
        };
      } catch (error) {
        if (error instanceof EditProposalError) {
          return {
            summary: 'Edit proposal commit rejected.',
            errorCode: error.code,
            errorMessage: error.message,
          };
        }
        return {
          summary: 'Edit proposal commit failed.',
          errorCode: 'COMMIT_FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'Commit failed.',
        };
      }
    },
  };
}

export function commitEditProposalToolDefinition(): ToolDefinition {
  return DEFINITION;
}
