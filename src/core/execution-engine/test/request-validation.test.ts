import {
  ExecutionEngineConfigurationValidator,
  ExecutionEngineService,
  ExecutionPolicyValidator,
  ExecutionRequestValidator,
} from '..';
import {
  cancellationToken,
  createExecutionRequest,
  FAIL_FAST_POLICY,
  RETRY_POLICY,
  STARTED_AT,
} from './execution-engine.fixture';

describe('Execution request and policy validation', () => {
  it('accepts a valid request and supported configuration', async () => {
    const request = await createExecutionRequest();
    expect(() => new ExecutionRequestValidator().validate(request)).not.toThrow();
    expect(() =>
      new ExecutionEngineConfigurationValidator().validate({
        maximumRetries: 2,
        maximumTimeoutMs: 60_000,
        maximumRetryDelayMs: 2_000,
        maximumMetadataEntries: 8,
      }),
    ).not.toThrow();
  });

  it.each([
    [null],
    [
      {
        maximumRetries: -1,
        maximumTimeoutMs: 0,
        maximumRetryDelayMs: 0,
        maximumMetadataEntries: 0,
      },
    ],
    [
      {
        maximumRetries: 1,
        maximumTimeoutMs: 1,
        maximumRetryDelayMs: 1,
        maximumMetadataEntries: 1,
        extra: true,
      },
    ],
  ])('rejects invalid engine configuration %#', (configuration) => {
    expect(() => new ExecutionEngineConfigurationValidator().validate(configuration)).toThrow(
      'validation failed',
    );
  });

  it.each([
    ['version', { schemaVersion: 2 }],
    ['identity', { executionId: 'INVALID ID' }],
    ['metadata time', { metadata: { correlationId: 'valid-id', requestedAt: 'bad', values: {} } }],
    ['cancellation reason', { cancellation: cancellationToken(true) }],
    ['unexpected cancellation reason', { cancellation: cancellationToken(false, 'Not cancelled') }],
    ['invalid cancellation contract', { cancellation: { cancelled: false, subscribe: true } }],
    [
      'invalid metadata value',
      { metadata: { correlationId: 'valid-id', requestedAt: STARTED_AT, values: { nested: {} } } },
    ],
    ['unexpected key', { unexpected: true }],
  ])('rejects an invalid request %s', async (_name, change) => {
    const request = { ...(await createExecutionRequest()), ...change };
    expect(() => new ExecutionRequestValidator().validate(request)).toThrow('validation failed');
  });

  it('rejects an invalid nested PromptPackage', async () => {
    const request = await createExecutionRequest();
    const prompt = { ...request.prompt, schemaVersion: 999 };
    expect(() => new ExecutionRequestValidator().validate({ ...request, prompt })).toThrow(
      'validation failed',
    );
  });

  it.each([
    [{ ...RETRY_POLICY, retry: { ...RETRY_POLICY.retry, maximumRetries: 6 } }],
    [
      {
        ...RETRY_POLICY,
        retry: { ...RETRY_POLICY.retry, baseDelayMs: 2_000, maximumDelayMs: 1_000 },
      },
    ],
    [
      {
        ...RETRY_POLICY,
        retry: { ...RETRY_POLICY.retry, retryableErrorCodes: ['DUPLICATE', 'DUPLICATE'] },
      },
    ],
    [{ ...RETRY_POLICY, failureStrategy: 'FAIL_FAST' }],
    [{ ...FAIL_FAST_POLICY, failureStrategy: 'RETRY_THEN_FAIL' }],
    [{ ...RETRY_POLICY, timeout: { durationMs: 0, startsAt: 'QUEUED' } }],
    [{ ...RETRY_POLICY, retry: null }],
    [{ ...RETRY_POLICY, timeout: null }],
  ])('rejects contradictory or unsafe policy %#', (policy) => {
    expect(() =>
      new ExecutionPolicyValidator().validate(policy, {
        maximumRetries: 5,
        maximumTimeoutMs: 300_000,
        maximumRetryDelayMs: 60_000,
        maximumMetadataEntries: 32,
      }),
    ).toThrow('validation failed');
  });

  it('enforces execution identity and explicit cancellation intent', async () => {
    const service = new ExecutionEngineService();
    const request = await createExecutionRequest();
    const created = service.create(request);
    expect(() => service.cancel(request, created, STARTED_AT)).toThrow('validation failed');
    const cancellation = await createExecutionRequest({
      cancellation: cancellationToken(true, 'User requested'),
    });
    expect(service.cancel(cancellation, created, STARTED_AT)).toMatchObject({ state: 'CANCELLED' });
    const other = await createExecutionRequest({ executionId: 'execution-two' });
    expect(() =>
      service.cancel(
        { ...other, cancellation: cancellationToken(true, 'Stop') },
        created,
        STARTED_AT,
      ),
    ).toThrow('validation failed');
  });
});
