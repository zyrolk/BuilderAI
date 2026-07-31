import type { ExecutionCancellationToken } from '../ports';
import {
  ExecutionEngineValidationError,
  type ExecutionFailure,
  type ExecutionPolicy,
  type ExecutionRetryDecision,
  type ExecutionSnapshot,
} from '../types';

export class RetryPolicyService {
  evaluate(
    policy: ExecutionPolicy,
    snapshot: ExecutionSnapshot,
    failure: ExecutionFailure,
    cancellation: ExecutionCancellationToken,
  ): ExecutionRetryDecision {
    if (snapshot.state !== 'EXECUTING') {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_RETRY_POLICY',
          path: '$.snapshot.state',
          message: 'retry decisions require an active reserved execution attempt',
        },
      ]);
    }
    const nextAttempt = snapshot.attempt + 1;
    if (cancellation.cancelled) return this.declined(nextAttempt, 'CANCELLATION_REQUESTED');
    if (policy.failureStrategy === 'FAIL_FAST') return this.declined(nextAttempt, 'FAIL_FAST');
    if (!failure.retryable || !policy.retry.retryableErrorCodes.includes(failure.code)) {
      return this.declined(nextAttempt, 'NOT_RETRYABLE');
    }
    if (snapshot.attempt > policy.retry.maximumRetries) {
      return this.declined(nextAttempt, 'RETRY_LIMIT_REACHED');
    }
    return {
      shouldRetry: true,
      nextAttempt,
      delayMs: this.calculateDelay(policy, snapshot.attempt),
      reason: 'RETRY_SCHEDULED',
    };
  }

  private calculateDelay(policy: ExecutionPolicy, completedAttempts: number): number {
    if (policy.retry.delayStrategy === 'NONE') return 0;
    if (policy.retry.delayStrategy === 'FIXED') return policy.retry.baseDelayMs;
    const exponent = Math.max(0, completedAttempts - 1);
    return Math.min(policy.retry.maximumDelayMs, policy.retry.baseDelayMs * 2 ** exponent);
  }

  private declined(
    nextAttempt: number,
    reason: Exclude<ExecutionRetryDecision['reason'], 'RETRY_SCHEDULED'>,
  ): ExecutionRetryDecision {
    return { shouldRetry: false, nextAttempt, delayMs: 0, reason };
  }
}
