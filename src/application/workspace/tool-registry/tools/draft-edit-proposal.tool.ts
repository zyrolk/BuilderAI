import { EditProposalError } from '../../edit-proposal/edit-proposal.types';
import type { EditProposalService } from '../../edit-proposal/edit-proposal.service';
import type {
  ToolDefinition,
  ToolHandler,
  ToolHandlerRawResult,
  ToolJsonValue,
} from '../tool-registry.types';

export interface DraftEditProposalToolDeps {
  readonly editProposals: EditProposalService;
}

const DEFINITION: ToolDefinition = {
  toolId: 'draft_edit_proposal',
  name: 'Draft edit proposal',
  description:
    'Stage bounded create/update/delete file intents for later Gate 2 preparation. Does not mutate the filesystem.',
  inputSchema: {
    type: 'object',
    required: ['operations'],
    properties: {
      operations: { type: 'array' },
      replace: { type: 'boolean' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      operationCount: { type: 'number' },
      contentDigest: { type: 'string' },
    },
  },
  capabilityClass: 'PLAN',
  readOnly: true,
  riskLevel: 'MEDIUM',
  authorizationAction: 'PREPARE',
  requiresGate2: false,
  approvalRequirement: 'NONE',
  workspaceScoped: true,
  timeoutMs: 15_000,
  supportsCancellation: true,
  evidencePolicy: 'DIGEST',
  auditPolicy: 'DIGEST',
  allowedPhases: ['UNDERSTANDING', 'PLANNING', 'CORRECTING'],
};

export function createDraftEditProposalTool(deps: DraftEditProposalToolDeps): ToolHandler {
  return {
    definition: DEFINITION,
    async execute(args, context): Promise<ToolHandlerRawResult> {
      if (context.cancellation.cancelled) {
        return {
          summary: 'Draft cancelled.',
          errorCode: 'CANCELLED',
          errorMessage: context.cancellation.reason ?? 'cancelled',
        };
      }
      try {
        const operations = parseOperations(args);
        const replace = parseReplace(args);
        const draft = deps.editProposals.draft({
          runId: context.runId,
          projectId: context.projectId,
          operations,
          replace,
        });
        const structured: ToolJsonValue = {
          operationCount: draft.operations.length,
          contentDigest: draft.contentDigest,
          kinds: draft.operations.map((operation) => operation.kind),
          paths: draft.operations.map((operation) => operation.logicalPath),
        };
        return {
          summary: `Drafted ${draft.operations.length} edit operation(s).`,
          structured,
        };
      } catch (error) {
        return mapEditError(error);
      }
    },
  };
}

function parseOperations(args: unknown): unknown[] {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new EditProposalError('INVALID_ARGS', 'operations required.');
  }
  const operations = (args as Record<string, unknown>).operations;
  if (!Array.isArray(operations)) {
    throw new EditProposalError('INVALID_ARGS', 'operations must be an array.');
  }
  return operations;
}

function parseReplace(args: unknown): boolean {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return false;
  return (args as Record<string, unknown>).replace === true;
}

function mapEditError(error: unknown): ToolHandlerRawResult {
  if (error instanceof EditProposalError) {
    return {
      summary: 'Edit proposal draft rejected.',
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  const message = error instanceof Error ? error.message.slice(0, 200) : 'Draft failed.';
  return {
    summary: 'Edit proposal draft failed.',
    errorCode: 'DRAFT_FAILED',
    errorMessage: message,
  };
}

export function draftEditProposalToolDefinition(): ToolDefinition {
  return DEFINITION;
}
