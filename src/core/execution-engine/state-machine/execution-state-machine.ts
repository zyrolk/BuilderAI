import {
  EXECUTION_SNAPSHOT_SCHEMA_VERSION,
  IllegalExecutionTransitionError,
  ExecutionEngineValidationError,
  type ExecutionSnapshot,
  type ExecutionState,
} from '../types';
import { isNonEmptyString, parseIsoTimestamp } from '../validators/validation-helpers';

export const EXECUTION_TRANSITIONS: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  CREATED: ['VALIDATED', 'FAILED', 'CANCELLED'],
  VALIDATED: ['QUEUED', 'FAILED', 'CANCELLED'],
  QUEUED: ['PREPARING', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
  PREPARING: ['READY', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
  READY: ['EXECUTING', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
  EXECUTING: ['QUEUED', 'COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
};

export class ExecutionStateMachine {
  create(executionId: string, createdAt: string): ExecutionSnapshot {
    if (!isNonEmptyString(executionId) || parseIsoTimestamp(createdAt) === undefined) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_EXECUTION_SNAPSHOT',
          path: '$',
          message: 'executionId and an ISO createdAt timestamp are required',
        },
      ]);
    }
    return {
      schemaVersion: EXECUTION_SNAPSHOT_SCHEMA_VERSION,
      executionId,
      state: 'CREATED',
      attempt: 0,
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      history: [],
    };
  }

  canTransition(from: ExecutionState, to: ExecutionState): boolean {
    return EXECUTION_TRANSITIONS[from].includes(to);
  }

  transition(
    snapshot: ExecutionSnapshot,
    to: ExecutionState,
    occurredAt: string,
    reason?: string,
  ): ExecutionSnapshot {
    if (!this.canTransition(snapshot.state, to)) {
      throw new IllegalExecutionTransitionError(snapshot.state, to);
    }
    const transitionTimestamp = parseIsoTimestamp(occurredAt);
    const updatedTimestamp = parseIsoTimestamp(snapshot.updatedAt);
    if (
      transitionTimestamp === undefined ||
      updatedTimestamp === undefined ||
      transitionTimestamp < updatedTimestamp
    ) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_EXECUTION_SNAPSHOT',
          path: '$.occurredAt',
          message: 'must be an ISO timestamp at or after snapshot.updatedAt',
        },
      ]);
    }
    if (reason !== undefined && !isNonEmptyString(reason)) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_EXECUTION_SNAPSHOT',
          path: '$.reason',
          message: 'must be a non-empty string when present',
        },
      ]);
    }
    const revision = snapshot.revision + 1;
    return {
      ...snapshot,
      state: to,
      attempt: snapshot.attempt + (to === 'EXECUTING' ? 1 : 0),
      revision,
      updatedAt: occurredAt,
      history: [
        ...snapshot.history,
        {
          sequence: revision,
          from: snapshot.state,
          to,
          occurredAt,
          ...(reason === undefined ? {} : { reason }),
        },
      ],
    };
  }
}
