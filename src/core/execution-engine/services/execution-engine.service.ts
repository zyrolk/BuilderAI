import type { ExecutionEngineConfiguration } from '../config';
import { DEFAULT_EXECUTION_ENGINE_CONFIGURATION } from '../config';
import { ExecutionStateMachine } from '../state-machine';
import {
  ExecutionEngineValidationError,
  IllegalExecutionTransitionError,
  type ExecutionFailure,
  type ExecutionRequest,
  type ExecutionRetryDecision,
  type ExecutionSnapshot,
  type ExecutionState,
} from '../types';
import { ExecutionRequestValidator, ExecutionSnapshotValidator } from '../validators';
import { RetryPolicyService } from './retry-policy.service';
import { TimeoutPolicyService } from './timeout-policy.service';

export interface RetryTransition {
  readonly snapshot: ExecutionSnapshot;
  readonly decision: ExecutionRetryDecision;
}

export class ExecutionEngineService {
  private readonly requestValidator: ExecutionRequestValidator;
  private readonly snapshotValidator: ExecutionSnapshotValidator = new ExecutionSnapshotValidator();
  private readonly stateMachine: ExecutionStateMachine = new ExecutionStateMachine();
  private readonly retryPolicy: RetryPolicyService = new RetryPolicyService();
  private readonly timeoutPolicy: TimeoutPolicyService = new TimeoutPolicyService();

  constructor(limits: ExecutionEngineConfiguration = DEFAULT_EXECUTION_ENGINE_CONFIGURATION) {
    this.requestValidator = new ExecutionRequestValidator(limits);
  }

  create(request: ExecutionRequest): ExecutionSnapshot {
    this.requestValidator.validate(request);
    const snapshot = this.stateMachine.create(request.executionId, request.metadata.requestedAt);
    this.snapshotValidator.validate(snapshot);
    return structuredClone(snapshot);
  }

  markValidated(snapshot: ExecutionSnapshot, occurredAt: string): ExecutionSnapshot {
    return this.applyTransition(snapshot, 'VALIDATED', occurredAt);
  }

  enqueue(snapshot: ExecutionSnapshot, occurredAt: string): ExecutionSnapshot {
    this.snapshotValidator.validate(snapshot);
    if (snapshot.state !== 'VALIDATED') {
      throw new IllegalExecutionTransitionError(snapshot.state, 'QUEUED');
    }
    return this.applyTransition(snapshot, 'QUEUED', occurredAt);
  }

  beginPreparation(snapshot: ExecutionSnapshot, occurredAt: string): ExecutionSnapshot {
    return this.applyTransition(snapshot, 'PREPARING', occurredAt);
  }

  markReady(snapshot: ExecutionSnapshot, occurredAt: string): ExecutionSnapshot {
    return this.applyTransition(snapshot, 'READY', occurredAt);
  }

  reserveExecution(snapshot: ExecutionSnapshot, occurredAt: string): ExecutionSnapshot {
    return this.applyTransition(snapshot, 'EXECUTING', occurredAt);
  }

  complete(snapshot: ExecutionSnapshot, occurredAt: string): ExecutionSnapshot {
    return this.applyTransition(snapshot, 'COMPLETED', occurredAt);
  }

  fail(
    snapshot: ExecutionSnapshot,
    failure: ExecutionFailure,
    occurredAt: string,
  ): ExecutionSnapshot {
    return this.applyTransition(
      snapshot,
      'FAILED',
      occurredAt,
      `${failure.code}: ${failure.message}`,
    );
  }

  cancel(
    request: ExecutionRequest,
    snapshot: ExecutionSnapshot,
    occurredAt: string,
  ): ExecutionSnapshot {
    this.assertMatchingIdentity(request, snapshot);
    if (!request.cancellation.cancelled) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_CANCELLATION',
          path: '$.cancellation.cancelled',
          message: 'cancellation must be requested before transitioning',
        },
      ]);
    }
    return this.applyTransition(snapshot, 'CANCELLED', occurredAt, request.cancellation.reason);
  }

  markTimedOut(
    request: ExecutionRequest,
    snapshot: ExecutionSnapshot,
    occurredAt: string,
  ): ExecutionSnapshot {
    this.assertMatchingIdentity(request, snapshot);
    const assessment = this.timeoutPolicy.assess(request.policy.timeout, snapshot, occurredAt);
    if (!assessment.timedOut) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_TIMEOUT_POLICY',
          path: '$.timeout',
          message: 'execution has not reached its configured timeout',
        },
      ]);
    }
    return this.applyTransition(snapshot, 'TIMED_OUT', occurredAt, 'Configured timeout elapsed');
  }

  retry(
    request: ExecutionRequest,
    snapshot: ExecutionSnapshot,
    failure: ExecutionFailure,
    occurredAt: string,
  ): RetryTransition {
    this.assertMatchingIdentity(request, snapshot);
    const decision = this.retryPolicy.evaluate(
      request.policy,
      snapshot,
      failure,
      request.cancellation,
    );
    if (!decision.shouldRetry) return { snapshot: structuredClone(snapshot), decision };
    return {
      snapshot: this.applyTransition(
        snapshot,
        'QUEUED',
        occurredAt,
        `Retry attempt ${decision.nextAttempt}`,
      ),
      decision,
    };
  }

  private applyTransition(
    snapshot: ExecutionSnapshot,
    to: ExecutionState,
    occurredAt: string,
    reason?: string,
  ): ExecutionSnapshot {
    this.snapshotValidator.validate(snapshot);
    const updated = this.stateMachine.transition(snapshot, to, occurredAt, reason);
    this.snapshotValidator.validate(updated);
    return structuredClone(updated);
  }

  private assertMatchingIdentity(request: ExecutionRequest, snapshot: ExecutionSnapshot): void {
    this.requestValidator.validate(request);
    this.snapshotValidator.validate(snapshot);
    if (request.executionId !== snapshot.executionId) {
      throw new ExecutionEngineValidationError([
        {
          code: 'INVALID_EXECUTION_REQUEST',
          path: '$.executionId',
          message: 'must match the execution snapshot identity',
        },
      ]);
    }
  }
}
