export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ProjectBrainValidationError extends Error {
  readonly code = 'PROJECT_BRAIN_VALIDATION_FAILED';

  constructor(readonly issues: readonly ValidationIssue[]) {
    super(`Project Brain validation failed with ${issues.length} issue(s).`);
    this.name = 'ProjectBrainValidationError';
  }
}

export class ProjectBrainNotFoundError extends Error {
  readonly code = 'PROJECT_BRAIN_NOT_FOUND';

  constructor(readonly projectId: string) {
    super(`Project Brain '${projectId}' was not found.`);
    this.name = 'ProjectBrainNotFoundError';
  }
}

export class ProjectBrainConflictError extends Error {
  readonly code = 'PROJECT_BRAIN_REVISION_CONFLICT';

  constructor(
    readonly projectId: string,
    readonly expectedRevision: number | null,
    readonly actualRevision: number | null,
  ) {
    super(
      `Project Brain '${projectId}' revision conflict: expected ${String(expectedRevision)}, received ${String(actualRevision)}.`,
    );
    this.name = 'ProjectBrainConflictError';
  }
}

export class ImmutableProjectIdentityError extends Error {
  readonly code = 'PROJECT_BRAIN_IDENTITY_IMMUTABLE';

  constructor(
    readonly expectedProjectId: string,
    readonly receivedProjectId: string,
  ) {
    super(
      `Project identity is immutable: expected '${expectedProjectId}', received '${receivedProjectId}'.`,
    );
    this.name = 'ImmutableProjectIdentityError';
  }
}

export class ProjectBrainHistoryRewriteError extends Error {
  readonly code = 'PROJECT_BRAIN_HISTORY_REWRITE';

  constructor(readonly historyPath: string) {
    super(`Append-only history at '${historyPath}' cannot be removed or rewritten.`);
    this.name = 'ProjectBrainHistoryRewriteError';
  }
}

export class ProjectBrainRecordConflictError extends Error {
  readonly code = 'PROJECT_BRAIN_RECORD_CONFLICT';

  constructor(
    readonly recordType: string,
    readonly recordId: string,
  ) {
    super(`${recordType} '${recordId}' already exists.`);
    this.name = 'ProjectBrainRecordConflictError';
  }
}

export class ProjectBrainInvariantError extends Error {
  readonly code = 'PROJECT_BRAIN_INVARIANT_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'ProjectBrainInvariantError';
  }
}

export class ProjectTaskNotFoundError extends Error {
  readonly code = 'PROJECT_BRAIN_TASK_NOT_FOUND';

  constructor(readonly taskId: string) {
    super(`Project Brain task '${taskId}' was not found.`);
    this.name = 'ProjectTaskNotFoundError';
  }
}

export class InvalidTaskTransitionError extends Error {
  readonly code = 'PROJECT_BRAIN_INVALID_TASK_TRANSITION';

  constructor(
    readonly taskId: string,
    readonly from: string,
    readonly to: string,
    message?: string,
  ) {
    super(message ?? `Task '${taskId}' cannot transition from ${from} to ${to}.`);
    this.name = 'InvalidTaskTransitionError';
  }
}
