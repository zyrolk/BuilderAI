import type { ExecutionState, ExecutionValidationIssue } from './execution-engine';

export class ExecutionEngineValidationError extends Error {
  readonly code = 'EXECUTION_ENGINE_VALIDATION_FAILED';

  constructor(readonly issues: readonly ExecutionValidationIssue[]) {
    super(`Execution Engine validation failed with ${issues.length} issue(s).`);
    this.name = 'ExecutionEngineValidationError';
  }
}

export class IllegalExecutionTransitionError extends ExecutionEngineValidationError {
  constructor(
    readonly from: ExecutionState,
    readonly to: ExecutionState,
  ) {
    super([
      {
        code: 'ILLEGAL_EXECUTION_TRANSITION',
        path: '$.state',
        message: `cannot transition from '${from}' to '${to}'`,
      },
    ]);
    this.name = 'IllegalExecutionTransitionError';
  }
}
