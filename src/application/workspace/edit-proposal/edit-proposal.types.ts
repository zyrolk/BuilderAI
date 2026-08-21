/**
 * Bounded Edit Proposal DTO (ADR-039). Proposal ≠ Apply.
 */

export const EDIT_PROPOSAL_SCHEMA_VERSION = 1 as const;

export const EDIT_OPERATION_KINDS = ['CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE'] as const;
export type EditOperationKind = (typeof EDIT_OPERATION_KINDS)[number];

export const EDIT_PROPOSAL_MAX_OPERATIONS = 32 as const;
export const EDIT_PROPOSAL_MAX_CONTENT_CHARS = 100_000 as const;
export const EDIT_PROPOSAL_MAX_TOTAL_CHARS = 400_000 as const;
export const EDIT_PROPOSAL_MAX_PATH_CHARS = 512 as const;

export interface EditProposalOperation {
  readonly kind: EditOperationKind;
  readonly logicalPath: string;
  readonly description: string;
  /** Required for CREATE/UPDATE; must be empty for DELETE. */
  readonly content?: string;
}

export interface EditProposalDraft {
  readonly schemaVersion: typeof EDIT_PROPOSAL_SCHEMA_VERSION;
  readonly runId: string;
  readonly projectId: string;
  readonly operations: readonly EditProposalOperation[];
  readonly updatedAt: string;
  readonly contentDigest: string;
}

export interface EditProposalInspection {
  readonly runId: string;
  readonly operationCount: number;
  readonly operations: readonly {
    readonly kind: EditOperationKind;
    readonly logicalPath: string;
    readonly description: string;
    readonly contentDigest?: string;
    readonly contentCharacters?: number;
  }[];
  readonly contentDigest: string;
  readonly validationFindings: readonly string[];
}

export interface EditProposalCommitResult {
  readonly preparationId: string;
  readonly expiresAt: string;
  readonly operationCount: number;
  readonly contentDigest: string;
  readonly gate2Summary: {
    readonly operationCount: number;
    readonly truncated: boolean;
    readonly totalCharacterCount: number;
  };
  readonly changePlanDigest: string;
}

export class EditProposalError extends Error {
  constructor(
    readonly code:
      | 'INVALID_ARGS'
      | 'VALIDATION_FAILED'
      | 'PROTECTED_PATH'
      | 'PATH_TRAVERSAL'
      | 'NOT_FOUND'
      | 'COMMIT_FAILED'
      | 'STALE_BASELINE',
    message: string,
  ) {
    super(message);
    this.name = 'EditProposalError';
  }
}
