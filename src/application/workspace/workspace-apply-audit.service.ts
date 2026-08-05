import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { ProjectChangeOperation } from '../../core/change-planner';
import type { FileApplyResult } from '../../core/file-apply';
import type { WorkspaceAuthorizationOutcome } from './workspace-authorization.types';
import type { WorkspacePrincipal } from './workspace-authorization.types';

export const APPLY_AUDIT_SCHEMA_VERSION = 1 as const;

export interface ApplyAuditRecord {
  readonly schemaVersion: typeof APPLY_AUDIT_SCHEMA_VERSION;
  readonly correlationId: string;
  readonly preparationId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly attemptedPaths: readonly string[];
  readonly operationKinds: readonly string[];
  readonly authorizationOutcome: WorkspaceAuthorizationOutcome;
  readonly applyOutcome: 'NOT_ATTEMPTED' | 'APPLIED' | 'REJECTED' | 'FAILED' | 'PARTIALLY_APPLIED';
  readonly reasonCode?: string;
  readonly timestamp: string;
}

export interface WorkspaceApplyAuditServiceOptions {
  readonly projectRoot: string;
  readonly clock?: () => Date;
}

export class WorkspaceApplyAuditService {
  private readonly auditFilePath: string;
  private readonly clock: () => Date;

  constructor(options: WorkspaceApplyAuditServiceOptions) {
    this.auditFilePath = path.join(options.projectRoot, '.builderai', 'apply-audit.jsonl');
    this.clock = options.clock ?? (() => new Date());
  }

  record(input: {
    readonly correlationId: string;
    readonly preparationId: string;
    readonly principal: WorkspacePrincipal;
    readonly operations?: readonly ProjectChangeOperation[];
    readonly authorizationOutcome: WorkspaceAuthorizationOutcome;
    readonly applyResult?: FileApplyResult;
    readonly reasonCode?: string;
  }): void {
    const operations = input.operations ?? [];
    const record: ApplyAuditRecord = {
      schemaVersion: APPLY_AUDIT_SCHEMA_VERSION,
      correlationId: input.correlationId,
      preparationId: input.preparationId,
      principalId: input.principal.principalId,
      projectId: input.principal.projectId,
      attemptedPaths: operations.map(({ logicalPath }) => logicalPath).sort(compareText),
      operationKinds: operations.map(({ kind }) => kind).sort(compareText),
      authorizationOutcome: input.authorizationOutcome,
      applyOutcome: resolveApplyOutcome(input.applyResult, input.authorizationOutcome),
      ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
      timestamp: this.clock().toISOString(),
    };

    mkdirSync(path.dirname(this.auditFilePath), { recursive: true });
    appendFileSync(this.auditFilePath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  getAuditFilePath(): string {
    return this.auditFilePath;
  }
}

function resolveApplyOutcome(
  applyResult: FileApplyResult | undefined,
  authorizationOutcome: WorkspaceAuthorizationOutcome,
): ApplyAuditRecord['applyOutcome'] {
  if (authorizationOutcome === 'REJECTED') return 'NOT_ATTEMPTED';
  if (applyResult === undefined) return 'NOT_ATTEMPTED';
  return applyResult.status;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}
