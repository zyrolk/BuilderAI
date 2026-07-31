import { createPromptPackage } from '../../prompt-orchestrator/test/prompt-orchestrator.fixture';
import type { ExecutionCancellationToken } from '../ports';
import type {
  ExecutionPolicy,
  ExecutionRequest,
  ExecutionSnapshot,
  ExecutionState,
} from '../types';
import type { ExecutionEngineService } from '../services';

export const STARTED_AT = '2026-07-30T18:00:00.000Z';

export const RETRY_POLICY: ExecutionPolicy = {
  priority: 'NORMAL',
  validationMode: 'STRICT',
  failureStrategy: 'RETRY_THEN_FAIL',
  retry: {
    maximumRetries: 2,
    delayStrategy: 'EXPONENTIAL',
    baseDelayMs: 100,
    maximumDelayMs: 1_000,
    retryableErrorCodes: ['PROVIDER_UNAVAILABLE', 'TRANSIENT_FAILURE'],
  },
  timeout: { durationMs: 30_000, startsAt: 'QUEUED' },
};

export const FAIL_FAST_POLICY: ExecutionPolicy = {
  ...RETRY_POLICY,
  failureStrategy: 'FAIL_FAST',
  retry: {
    maximumRetries: 0,
    delayStrategy: 'NONE',
    baseDelayMs: 0,
    maximumDelayMs: 0,
    retryableErrorCodes: [],
  },
};

export function cancellationToken(cancelled = false, reason?: string): ExecutionCancellationToken {
  return {
    cancelled,
    ...(reason === undefined ? {} : { reason }),
    subscribe: () => () => undefined,
  };
}

export async function createExecutionRequest(
  overrides: Partial<ExecutionRequest> = {},
): Promise<ExecutionRequest> {
  return {
    schemaVersion: 1,
    executionId: 'execution-one',
    prompt: await createPromptPackage(),
    metadata: {
      correlationId: 'sprint-six',
      requestedAt: STARTED_AT,
      values: { purpose: 'execution-contract-test' },
    },
    policy: RETRY_POLICY,
    cancellation: cancellationToken(),
    ...overrides,
  };
}

export function advance(
  service: ExecutionEngineService,
  snapshot: ExecutionSnapshot,
  states: readonly ExecutionState[],
): ExecutionSnapshot {
  return states.reduce((current, state) => {
    const occurredAt = new Date(Date.parse(current.updatedAt) + 1_000).toISOString();
    switch (state) {
      case 'VALIDATED':
        return service.markValidated(current, occurredAt);
      case 'QUEUED':
        return service.enqueue(current, occurredAt);
      case 'PREPARING':
        return service.beginPreparation(current, occurredAt);
      case 'READY':
        return service.markReady(current, occurredAt);
      case 'EXECUTING':
        return service.reserveExecution(current, occurredAt);
      case 'COMPLETED':
        return service.complete(current, occurredAt);
      case 'FAILED':
        return service.fail(
          current,
          { code: 'TRANSIENT_FAILURE', message: 'Fixture failure.', retryable: true },
          occurredAt,
        );
      case 'CREATED':
      case 'CANCELLED':
      case 'TIMED_OUT':
        throw new Error(`Fixture cannot advance to ${state}`);
    }
  }, snapshot);
}
