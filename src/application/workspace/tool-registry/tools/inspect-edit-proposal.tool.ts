import { EditProposalError } from '../../edit-proposal/edit-proposal.types';
import type { EditProposalService } from '../../edit-proposal/edit-proposal.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface InspectEditProposalToolDeps {
  readonly editProposals: EditProposalService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'inspect_edit_proposal',
  name: 'Inspect edit proposal',
  description:
    'Inspect the current edit proposal draft (paths, kinds, digests, validation findings). No ChangePlan or diffs.',
  inputSchema: { type: 'object', properties: {} },
  outputSchema: {
    type: 'object',
    properties: {
      operationCount: { type: 'number' },
      operations: { type: 'array' },
      contentDigest: { type: 'string' },
      validationFindings: { type: 'array' },
    },
  },
  capabilityClass: 'INSPECT',
  readOnly: true,
  riskLevel: 'LOW',
  authorizationAction: 'PREPARE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 10_000,
  supportsCancellation: true,
  evidencePolicy: 'SUMMARY',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'PLANNING', 'CORRECTING', 'AWAITING_GATE2'],
};

export function createInspectEditProposalTool(deps: InspectEditProposalToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(_args, context): Promise<ToolHandlerRawResult> {
      try {
        const inspection = deps.editProposals.inspect(context.runId, context.projectId);
        const structured: ToolJsonValue = {
          operationCount: inspection.operationCount,
          operations: inspection.operations.map((operation) => ({
            kind: operation.kind,
            logicalPath: operation.logicalPath,
            description: operation.description,
            contentDigest: operation.contentDigest ?? null,
            contentCharacters: operation.contentCharacters ?? null,
          })),
          contentDigest: inspection.contentDigest,
          validationFindings: inspection.validationFindings,
        };
        return {
          summary: `Proposal has ${inspection.operationCount} operation(s).`,
          structured,
        };
      } catch (error) {
        if (error instanceof EditProposalError) {
          return {
            summary: 'Edit proposal inspect rejected.',
            errorCode: error.code,
            errorMessage: error.message,
          };
        }
        return {
          summary: 'Edit proposal inspect failed.',
          errorCode: 'INSPECT_FAILED',
          errorMessage: error instanceof Error ? error.message.slice(0, 200) : 'Inspect failed.',
        };
      }
    },
  };
}

export function inspectEditProposalToolDefinition(): ToolDefinition {
  return DEFINITION;
}
