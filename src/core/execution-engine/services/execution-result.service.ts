import {
  DEFAULT_EXECUTION_ENGINE_CONFIGURATION,
  type ExecutionEngineConfiguration,
} from '../config';
import {
  EXECUTION_RESULT_SCHEMA_VERSION,
  ExecutionEngineValidationError,
  type ExecutionResult,
  type ExecutionResultInput,
  type ExecutionSnapshot,
  type TerminalExecutionState,
} from '../types';
import { ExecutionResultValidator, ExecutionSnapshotValidator } from '../validators';
import { parseIsoTimestamp } from '../validators/validation-helpers';

export class ExecutionResultService {
  private readonly snapshotValidator: ExecutionSnapshotValidator = new ExecutionSnapshotValidator();
  private readonly resultValidator: ExecutionResultValidator;

  constructor(limits: ExecutionEngineConfiguration = DEFAULT_EXECUTION_ENGINE_CONFIGURATION) {
    this.resultValidator = new ExecutionResultValidator(limits);
  }

  create(snapshot: ExecutionSnapshot, input: ExecutionResultInput): ExecutionResult {
    this.snapshotValidator.validate(snapshot);
    if (!isTerminal(snapshot.state)) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_EXECUTION_RESULT',
          path: '$.status',
          message: 'results can only be created from terminal snapshots',
        },
      ]);
    }
    const createdAt = parseIsoTimestamp(snapshot.createdAt);
    const finishedAt = parseIsoTimestamp(snapshot.updatedAt);
    if (createdAt === undefined || finishedAt === undefined) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_EXECUTION_RESULT',
          path: '$.timing',
          message: 'snapshot timing is invalid',
        },
      ]);
    }
    const result: ExecutionResult = {
      schemaVersion: EXECUTION_RESULT_SCHEMA_VERSION,
      executionId: snapshot.executionId,
      status: snapshot.state,
      diagnostics: input.diagnostics ?? [],
      timing: {
        createdAt: snapshot.createdAt,
        finishedAt: snapshot.updatedAt,
        durationMs: finishedAt - createdAt,
      },
      usage: input.usage,
      artifacts: input.artifacts ?? [],
      errors: input.errors ?? [],
      metadata: input.metadata ?? {},
    };
    this.resultValidator.validate(result);
    return structuredClone(result);
  }
}

function isTerminal(state: ExecutionSnapshot['state']): state is TerminalExecutionState {
  return ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(state);
}
