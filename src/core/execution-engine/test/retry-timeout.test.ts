import { ExecutionEngineService, RetryPolicyService, TimeoutPolicyService } from '..';
import {
  advance,
  cancellationToken,
  createExecutionRequest,
  FAIL_FAST_POLICY,
  RETRY_POLICY,
  STARTED_AT,
} from './execution-engine.fixture';

const transientFailure = {
  code: 'PROVIDER_UNAVAILABLE',
  message: 'A future provider is unavailable.',
  retryable: true,
} as const;

describe('Retry and timeout policy decisions', () => {
  it('schedules exponential retries without waiting or executing', async () => {
    const service = new ExecutionEngineService();
    const request = await createExecutionRequest();
    const firstFailure = advance(service, service.create(request), [
      'VALIDATED',
      'QUEUED',
      'PREPARING',
      'READY',
      'EXECUTING',
    ]);
    const retried = service.retry(
      request,
      firstFailure,
      transientFailure,
      '2026-07-30T18:00:10.000Z',
    );
    expect(retried.decision).toEqual({
      shouldRetry: true,
      nextAttempt: 2,
      delayMs: 100,
      reason: 'RETRY_SCHEDULED',
    });
    expect(retried.snapshot.state).toBe('QUEUED');
    expect(firstFailure.state).toBe('EXECUTING');
  });

  it.each([
    ['fail fast', FAIL_FAST_POLICY, transientFailure, cancellationToken(), 'FAIL_FAST'],
    [
      'not retryable',
      RETRY_POLICY,
      { ...transientFailure, retryable: false },
      cancellationToken(),
      'NOT_RETRYABLE',
    ],
    [
      'unlisted code',
      RETRY_POLICY,
      { ...transientFailure, code: 'PERMANENT_FAILURE' },
      cancellationToken(),
      'NOT_RETRYABLE',
    ],
    [
      'cancelled',
      RETRY_POLICY,
      transientFailure,
      cancellationToken(true, 'No longer needed'),
      'CANCELLATION_REQUESTED',
    ],
  ])('declines retry when %s', async (_name, policy, failure, cancellation, reason) => {
    const service = new ExecutionEngineService();
    const request = await createExecutionRequest({ policy, cancellation });
    const executing = advance(service, service.create(request), [
      'VALIDATED',
      'QUEUED',
      'PREPARING',
      'READY',
      'EXECUTING',
    ]);
    const decision = new RetryPolicyService().evaluate(policy, executing, failure, cancellation);
    expect(decision).toMatchObject({ shouldRetry: false, delayMs: 0, reason });
  });

  it('caps exponential delay and stops after the retry limit', async () => {
    const service = new ExecutionEngineService();
    const request = await createExecutionRequest({
      policy: {
        ...RETRY_POLICY,
        retry: { ...RETRY_POLICY.retry, baseDelayMs: 800, maximumDelayMs: 1_000 },
      },
    });
    let snapshot = advance(service, service.create(request), [
      'VALIDATED',
      'QUEUED',
      'PREPARING',
      'READY',
      'EXECUTING',
    ]);
    snapshot = service.retry(
      request,
      snapshot,
      transientFailure,
      '2026-07-30T18:00:10.000Z',
    ).snapshot;
    snapshot = advance(service, snapshot, ['PREPARING', 'READY', 'EXECUTING']);
    expect(
      new RetryPolicyService().evaluate(
        request.policy,
        snapshot,
        transientFailure,
        request.cancellation,
      ).delayMs,
    ).toBe(1_000);
    snapshot = service.retry(
      request,
      snapshot,
      transientFailure,
      '2026-07-30T18:00:30.000Z',
    ).snapshot;
    snapshot = advance(service, snapshot, ['PREPARING', 'READY', 'EXECUTING']);
    expect(
      new RetryPolicyService().evaluate(
        request.policy,
        snapshot,
        transientFailure,
        request.cancellation,
      ),
    ).toMatchObject({
      shouldRetry: false,
      reason: 'RETRY_LIMIT_REACHED',
      nextAttempt: 4,
    });
  });

  it('rejects retry evaluation before failure', async () => {
    const request = await createExecutionRequest();
    const created = new ExecutionEngineService().create(request);
    expect(() =>
      new RetryPolicyService().evaluate(
        request.policy,
        created,
        transientFailure,
        request.cancellation,
      ),
    ).toThrow('validation failed');
  });

  it('assesses inactive, active, expired, and terminal timeouts deterministically', async () => {
    const service = new ExecutionEngineService();
    const timeout = new TimeoutPolicyService();
    const request = await createExecutionRequest();
    const created = service.create(request);
    expect(timeout.assess(request.policy.timeout, created, STARTED_AT)).toEqual({
      active: false,
      timedOut: false,
      elapsedMs: 0,
      remainingMs: 30_000,
    });
    const queued = advance(service, created, ['VALIDATED', 'QUEUED']);
    expect(
      timeout.assess(request.policy.timeout, queued, '2026-07-30T18:00:10.000Z'),
    ).toMatchObject({
      active: true,
      timedOut: false,
      elapsedMs: 8_000,
      remainingMs: 22_000,
    });
    expect(
      timeout.assess(request.policy.timeout, queued, '2026-07-30T18:00:40.000Z'),
    ).toMatchObject({
      active: true,
      timedOut: true,
      remainingMs: 0,
    });
    const timedOut = service.markTimedOut(request, queued, '2026-07-30T18:00:40.000Z');
    expect(timeout.assess(request.policy.timeout, timedOut, timedOut.updatedAt)).toMatchObject({
      active: false,
      timedOut: true,
    });
  });

  it('rejects invalid timeout assessment time', async () => {
    const request = await createExecutionRequest();
    const service = new ExecutionEngineService();
    const queued = advance(service, service.create(request), ['VALIDATED', 'QUEUED']);
    expect(() => new TimeoutPolicyService().assess(request.policy.timeout, queued, 'bad')).toThrow(
      'validation failed',
    );
    expect(() =>
      new TimeoutPolicyService().assess(request.policy.timeout, queued, STARTED_AT),
    ).toThrow('validation failed');
  });

  it('rejects a timeout transition before the deadline', async () => {
    const request = await createExecutionRequest();
    const service = new ExecutionEngineService();
    const queued = advance(service, service.create(request), ['VALIDATED', 'QUEUED']);
    expect(() => service.markTimedOut(request, queued, '2026-07-30T18:00:10.000Z')).toThrow(
      'validation failed',
    );
  });
});
