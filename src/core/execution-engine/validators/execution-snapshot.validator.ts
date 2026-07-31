import { EXECUTION_TRANSITIONS } from '../state-machine';
import {
  EXECUTION_SNAPSHOT_SCHEMA_VERSION,
  EXECUTION_STATES,
  ExecutionEngineValidationError,
  type ExecutionSnapshot,
  type ExecutionState,
  type ExecutionValidationIssue,
} from '../types';
import {
  addIssue,
  EXECUTION_IDENTIFIER_PATTERN,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isRecord,
  parseIsoTimestamp,
  validateExactKeys,
} from './validation-helpers';

export class ExecutionSnapshotValidator {
  validate(value: unknown): asserts value is ExecutionSnapshot {
    const issues: ExecutionValidationIssue[] = [];
    if (!hasSnapshotShape(value)) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_EXECUTION_SNAPSHOT',
          path: '$',
          message: 'must contain complete execution snapshot structure',
        },
      ]);
    }
    validateExactKeys(
      value,
      [
        'schemaVersion',
        'executionId',
        'state',
        'attempt',
        'revision',
        'createdAt',
        'updatedAt',
        'history',
      ],
      '$',
      issues,
      'INVALID_EXECUTION_SNAPSHOT',
    );
    if (value.schemaVersion !== EXECUTION_SNAPSHOT_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_EXECUTION_VERSION',
        '$.schemaVersion',
        `must equal ${EXECUTION_SNAPSHOT_SCHEMA_VERSION}`,
      );
    }
    if (!EXECUTION_IDENTIFIER_PATTERN.test(value.executionId)) {
      addIssue(issues, 'INVALID_EXECUTION_SNAPSHOT', '$.executionId', 'has an invalid identifier');
    }
    if (!EXECUTION_STATES.includes(value.state)) {
      addIssue(issues, 'INVALID_EXECUTION_SNAPSHOT', '$.state', 'is unsupported');
    }
    if (!isNonNegativeSafeInteger(value.attempt)) {
      addIssue(issues, 'INVALID_EXECUTION_SNAPSHOT', '$.attempt', 'must be non-negative');
    }
    if (!isNonNegativeSafeInteger(value.revision) || value.revision !== value.history.length) {
      addIssue(issues, 'INVALID_EXECUTION_SNAPSHOT', '$.revision', 'must equal history length');
    }
    this.validateHistory(value, issues);
    if (issues.length > 0) throw new ExecutionEngineValidationError(issues);
  }

  private validateHistory(value: ExecutionSnapshot, issues: ExecutionValidationIssue[]): void {
    let state: ExecutionState = 'CREATED';
    let previousTime = parseIsoTimestamp(value.createdAt);
    let attempts = 0;
    if (previousTime === undefined) {
      addIssue(issues, 'INVALID_EXECUTION_SNAPSHOT', '$.createdAt', 'must be an ISO timestamp');
    }
    value.history.forEach((transition, index) => {
      const path = `$.history[${index}]`;
      validateExactKeys(
        transition,
        ['sequence', 'from', 'to', 'occurredAt', 'reason'],
        path,
        issues,
        'INVALID_EXECUTION_SNAPSHOT',
      );
      if (transition.sequence !== index + 1) {
        addIssue(issues, 'INVALID_EXECUTION_SNAPSHOT', `${path}.sequence`, 'must be contiguous');
      }
      if (transition.from !== state || !EXECUTION_TRANSITIONS[state].includes(transition.to)) {
        addIssue(
          issues,
          'ILLEGAL_EXECUTION_TRANSITION',
          path,
          `does not legally continue state '${state}'`,
        );
      }
      const occurredAt = parseIsoTimestamp(transition.occurredAt);
      if (occurredAt === undefined || (previousTime !== undefined && occurredAt < previousTime)) {
        addIssue(
          issues,
          'INVALID_EXECUTION_SNAPSHOT',
          `${path}.occurredAt`,
          'must be a monotonic ISO timestamp',
        );
      }
      if (transition.reason !== undefined && !isNonEmptyString(transition.reason)) {
        addIssue(
          issues,
          'INVALID_EXECUTION_SNAPSHOT',
          `${path}.reason`,
          'must be non-empty when present',
        );
      }
      if (transition.to === 'EXECUTING') attempts += 1;
      state = transition.to;
      if (occurredAt !== undefined) previousTime = occurredAt;
    });
    if (value.state !== state) {
      addIssue(issues, 'INVALID_EXECUTION_SNAPSHOT', '$.state', 'must equal final history state');
    }
    if (value.attempt !== attempts) {
      addIssue(
        issues,
        'INVALID_EXECUTION_SNAPSHOT',
        '$.attempt',
        'must equal EXECUTING transition count',
      );
    }
    const updatedAt = parseIsoTimestamp(value.updatedAt);
    if (updatedAt === undefined || updatedAt !== previousTime) {
      addIssue(
        issues,
        'INVALID_EXECUTION_SNAPSHOT',
        '$.updatedAt',
        'must equal the latest transition timestamp',
      );
    }
  }
}

function hasSnapshotShape(value: unknown): value is ExecutionSnapshot {
  return (
    isRecord(value) &&
    typeof value.executionId === 'string' &&
    EXECUTION_STATES.includes(value.state as never) &&
    typeof value.attempt === 'number' &&
    typeof value.revision === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.history) &&
    value.history.every(
      (transition) =>
        isRecord(transition) &&
        typeof transition.sequence === 'number' &&
        EXECUTION_STATES.includes(transition.from as never) &&
        EXECUTION_STATES.includes(transition.to as never) &&
        typeof transition.occurredAt === 'string',
    )
  );
}
