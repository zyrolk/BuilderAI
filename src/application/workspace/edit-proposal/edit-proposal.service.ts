import { createHash } from 'node:crypto';

import type { ChangePlannerService } from '../../../core/change-planner';
import type { WorkspaceBaselinePort } from '../../../core/change-planner/ports/workspace-baseline.port';
import type { WorkspaceVisibilityPort } from '../../../core/change-planner/ports/workspace-visibility.port';
import type { ResponsePackage } from '../../../core/response-processor';
import { digestChangePlanOperations } from '../../../core/workflow-ledger';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';
import { normalizeProjectPath } from '../../../core/context-builder/internal/path';
import type { Gate2ReviewProjection } from '../gate2-review';
import { Gate2ReviewProjectionService } from '../gate2-review';
import type { WorkspacePreparation } from '../workspace-runtime.types';
import {
  EDIT_OPERATION_KINDS,
  EDIT_PROPOSAL_MAX_CONTENT_CHARS,
  EDIT_PROPOSAL_MAX_OPERATIONS,
  EDIT_PROPOSAL_MAX_PATH_CHARS,
  EDIT_PROPOSAL_MAX_TOTAL_CHARS,
  EDIT_PROPOSAL_SCHEMA_VERSION,
  EditProposalError,
  type EditProposalCommitResult,
  type EditProposalDraft,
  type EditProposalInspection,
  type EditOperationKind,
  type EditProposalOperation,
} from './edit-proposal.types';
import {
  buildResponsePackageFromEditOperations,
  digestEditOperations,
} from './response-package-from-proposal';

export interface EditProposalPreparePort {
  prepareFromResponsePackage(responsePackage: ResponsePackage): Promise<WorkspacePreparation>;
}

export interface EditProposalServiceDeps {
  readonly changePlanner: ChangePlannerService;
  readonly preparePort: EditProposalPreparePort;
  readonly clock: { now(): Date };
  readonly ids: { generate(): string };
  readonly pathProtection?: WorkspacePathProtectionPolicy;
  readonly workspaceVisibility?: WorkspaceVisibilityPort;
  readonly workspaceBaseline?: WorkspaceBaselinePort;
  readonly gate2Projection?: Gate2ReviewProjectionService;
  /** Optional expected baseline digest; mismatch fails commit closed. */
  readonly readBaselineDigest?: () => Promise<string | undefined>;
  readonly expectedBaselineDigest?: string;
}

/**
 * Server-owned edit proposal drafts. Never mutates the target filesystem (ADR-039).
 */
export class EditProposalService {
  private readonly drafts = new Map<string, EditProposalDraft>();
  private readonly pathProtection: WorkspacePathProtectionPolicy;
  private readonly gate2Projection: Gate2ReviewProjectionService;

  constructor(private readonly deps: EditProposalServiceDeps) {
    this.pathProtection = deps.pathProtection ?? DEFAULT_WORKSPACE_PATH_PROTECTION;
    this.gate2Projection =
      deps.gate2Projection ?? new Gate2ReviewProjectionService(undefined, this.pathProtection);
  }

  draft(input: {
    readonly runId: string;
    readonly projectId: string;
    readonly operations: readonly unknown[];
    readonly replace?: boolean;
  }): EditProposalDraft {
    const normalized = this.normalizeOperations(input.operations);
    const key = draftKey(input.runId, input.projectId);
    const existing = this.drafts.get(key);
    const operations =
      input.replace === true || existing === undefined
        ? normalized
        : mergeOperations(existing.operations, normalized);

    if (operations.length > EDIT_PROPOSAL_MAX_OPERATIONS) {
      throw new EditProposalError(
        'VALIDATION_FAILED',
        `At most ${EDIT_PROPOSAL_MAX_OPERATIONS} operations are allowed.`,
      );
    }

    const draft: EditProposalDraft = {
      schemaVersion: EDIT_PROPOSAL_SCHEMA_VERSION,
      runId: input.runId,
      projectId: input.projectId,
      operations,
      updatedAt: this.deps.clock.now().toISOString(),
      contentDigest: digestEditOperations(operations),
    };
    this.drafts.set(key, draft);
    return draft;
  }

  inspect(runId: string, projectId: string): EditProposalInspection {
    const draft = this.requireDraft(runId, projectId);
    const findings = this.collectFindings(draft.operations);
    return {
      runId,
      operationCount: draft.operations.length,
      operations: draft.operations.map((operation) => ({
        kind: operation.kind,
        logicalPath: operation.logicalPath,
        description: operation.description,
        contentDigest:
          operation.content === undefined
            ? undefined
            : createHash('sha256').update(operation.content, 'utf8').digest('hex').slice(0, 16),
        contentCharacters: operation.content?.length,
      })),
      contentDigest: draft.contentDigest,
      validationFindings: findings,
    };
  }

  async commit(runId: string, projectId: string): Promise<EditProposalCommitResult> {
    const draft = this.requireDraft(runId, projectId);
    const findings = this.collectFindings(draft.operations);
    if (findings.length > 0) {
      throw new EditProposalError('VALIDATION_FAILED', findings.join('; '));
    }

    if (
      this.deps.expectedBaselineDigest !== undefined &&
      this.deps.readBaselineDigest !== undefined
    ) {
      const current = await this.deps.readBaselineDigest();
      if (current !== this.deps.expectedBaselineDigest) {
        throw new EditProposalError(
          'STALE_BASELINE',
          'Repository baseline changed; refresh investigation and proposal before commit.',
        );
      }
    }

    const executionId = this.deps.ids.generate();
    const responsePackage = buildResponsePackageFromEditOperations(
      draft.operations,
      executionId,
      this.deps.clock.now().toISOString(),
    );

    // Validate plan before prepare (fail closed without store write on planner errors).
    this.deps.changePlanner.plan(
      responsePackage,
      this.deps.workspaceVisibility,
      this.deps.workspaceBaseline,
    );

    const preparation = await this.deps.preparePort.prepareFromResponsePackage(responsePackage);
    const gate2: Gate2ReviewProjection = preparation.gate2Review;

    // Clear draft after successful prepare so revisions require a new draft.
    this.drafts.delete(draftKey(runId, projectId));

    return {
      preparationId: preparation.preparationId,
      expiresAt: preparation.expiresAt,
      operationCount: preparation.changePlan.changeSet.operations.length,
      contentDigest: draft.contentDigest,
      gate2Summary: {
        operationCount: gate2.operationDiffs.length,
        truncated: gate2.truncated,
        totalCharacterCount: gate2.totalCharacterCount,
      },
      changePlanDigest: digestChangePlanOperations(preparation.changePlan),
    };
  }

  clear(runId: string, projectId: string): void {
    this.drafts.delete(draftKey(runId, projectId));
  }

  private requireDraft(runId: string, projectId: string): EditProposalDraft {
    const draft = this.drafts.get(draftKey(runId, projectId));
    if (draft === undefined) {
      throw new EditProposalError('NOT_FOUND', 'No edit proposal draft exists for this run.');
    }
    return draft;
  }

  private normalizeOperations(raw: readonly unknown[]): EditProposalOperation[] {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new EditProposalError('INVALID_ARGS', 'operations must be a non-empty array.');
    }
    if (raw.length > EDIT_PROPOSAL_MAX_OPERATIONS) {
      throw new EditProposalError(
        'VALIDATION_FAILED',
        `At most ${EDIT_PROPOSAL_MAX_OPERATIONS} operations are allowed.`,
      );
    }

    let totalChars = 0;
    const operations: EditProposalOperation[] = [];
    for (const entry of raw) {
      const operation = this.normalizeOne(entry);
      totalChars += operation.content?.length ?? 0;
      if (totalChars > EDIT_PROPOSAL_MAX_TOTAL_CHARS) {
        throw new EditProposalError(
          'VALIDATION_FAILED',
          `Total content exceeds ${EDIT_PROPOSAL_MAX_TOTAL_CHARS} characters.`,
        );
      }
      operations.push(operation);
    }
    return operations;
  }

  private normalizeOne(entry: unknown): EditProposalOperation {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new EditProposalError('INVALID_ARGS', 'Each operation must be an object.');
    }
    const record = entry as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind !== 'string' || !EDIT_OPERATION_KINDS.includes(kind as EditOperationKind)) {
      throw new EditProposalError(
        'INVALID_ARGS',
        'kind must be CREATE_FILE, UPDATE_FILE, or DELETE_FILE.',
      );
    }
    const operationKind = kind as EditOperationKind;
    const logicalPath = parseLogicalPath(record.logicalPath);
    if (logicalPath === undefined) {
      throw new EditProposalError('PATH_TRAVERSAL', 'logicalPath is invalid or traverses parents.');
    }
    if (this.pathProtection.isMutationProtected(logicalPath)) {
      throw new EditProposalError('PROTECTED_PATH', 'Path is protected and cannot be proposed.');
    }
    const description = typeof record.description === 'string' ? record.description.trim() : '';
    if (description.length === 0 || description.length > 500) {
      throw new EditProposalError('INVALID_ARGS', 'description must be 1..500 characters.');
    }

    if (operationKind === 'DELETE_FILE') {
      if (record.content !== undefined && record.content !== '') {
        throw new EditProposalError('INVALID_ARGS', 'DELETE_FILE content must be empty.');
      }
      return { kind: operationKind, logicalPath, description };
    }

    if (typeof record.content !== 'string') {
      throw new EditProposalError('INVALID_ARGS', `${operationKind} requires string content.`);
    }
    if (record.content.length > EDIT_PROPOSAL_MAX_CONTENT_CHARS) {
      throw new EditProposalError(
        'VALIDATION_FAILED',
        `Content exceeds ${EDIT_PROPOSAL_MAX_CONTENT_CHARS} characters.`,
      );
    }
    return { kind: operationKind, logicalPath, description, content: record.content };
  }

  private collectFindings(operations: readonly EditProposalOperation[]): string[] {
    const findings: string[] = [];
    const seen = new Set<string>();
    for (const operation of operations) {
      if (seen.has(operation.logicalPath)) {
        findings.push(`Duplicate path ${operation.logicalPath}.`);
      }
      seen.add(operation.logicalPath);
      if (this.pathProtection.isMutationProtected(operation.logicalPath)) {
        findings.push(`Protected path ${operation.logicalPath}.`);
      }
    }
    return findings;
  }
}

function draftKey(runId: string, projectId: string): string {
  return `${projectId}::${runId}`;
}

function parseLogicalPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\\/g, '/');
  if (trimmed.length === 0 || trimmed.length > EDIT_PROPOSAL_MAX_PATH_CHARS) return undefined;
  if (trimmed.startsWith('/') || trimmed.includes('..') || trimmed.includes('\0')) return undefined;
  if (/^[a-zA-Z]:/.test(trimmed)) return undefined;
  try {
    return normalizeProjectPath(trimmed);
  } catch {
    return undefined;
  }
}

function mergeOperations(
  existing: readonly EditProposalOperation[],
  incoming: readonly EditProposalOperation[],
): EditProposalOperation[] {
  const map = new Map<string, EditProposalOperation>();
  for (const operation of existing) map.set(operation.logicalPath, operation);
  for (const operation of incoming) map.set(operation.logicalPath, operation);
  return [...map.values()].sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
}
