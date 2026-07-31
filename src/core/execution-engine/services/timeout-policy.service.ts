import {
  ExecutionEngineValidationError,
  type ExecutionSnapshot,
  type ExecutionTimeoutAssessment,
  type ExecutionTimeoutPolicy,
} from '../types';
import { parseIsoTimestamp } from '../validators/validation-helpers';

export class TimeoutPolicyService {
  assess(
    policy: ExecutionTimeoutPolicy,
    snapshot: ExecutionSnapshot,
    evaluatedAt: string,
  ): ExecutionTimeoutAssessment {
    const evaluatedTimestamp = parseIsoTimestamp(evaluatedAt);
    if (evaluatedTimestamp === undefined) {
      throw this.invalidTime('must be an ISO timestamp');
    }
    const start = snapshot.history.find((transition) => transition.to === policy.startsAt);
    if (start === undefined) {
      return {
        active: false,
        timedOut: false,
        elapsedMs: 0,
        remainingMs: policy.durationMs,
      };
    }
    const startedTimestamp = parseIsoTimestamp(start.occurredAt);
    if (startedTimestamp === undefined || evaluatedTimestamp < startedTimestamp) {
      throw this.invalidTime('must be at or after the timeout start');
    }
    const elapsedMs = evaluatedTimestamp - startedTimestamp;
    const terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'].includes(snapshot.state);
    return {
      active: !terminal,
      timedOut: snapshot.state === 'TIMED_OUT' || (!terminal && elapsedMs >= policy.durationMs),
      elapsedMs,
      remainingMs: Math.max(0, policy.durationMs - elapsedMs),
      startedAt: start.occurredAt,
    };
  }

  private invalidTime(message: string): ExecutionEngineValidationError {
    return new ExecutionEngineValidationError([
      { code: 'INVALID_TIMEOUT_POLICY', path: '$.evaluatedAt', message },
    ]);
  }
}
