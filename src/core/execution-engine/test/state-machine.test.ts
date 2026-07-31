import { ExecutionEngineService, ExecutionStateMachine, IllegalExecutionTransitionError } from '..';
import { advance, createExecutionRequest, STARTED_AT } from './execution-engine.fixture';

describe('Execution state machine', () => {
  it('moves through the complete lifecycle with append-only immutable history', async () => {
    const request = await createExecutionRequest();
    const service = new ExecutionEngineService();
    const created = service.create(request);
    const completed = advance(service, created, [
      'VALIDATED',
      'QUEUED',
      'PREPARING',
      'READY',
      'EXECUTING',
      'COMPLETED',
    ]);

    expect(created).toMatchObject({ state: 'CREATED', revision: 0, attempt: 0, history: [] });
    expect(completed).toMatchObject({ state: 'COMPLETED', revision: 6, attempt: 1 });
    expect(completed.history.map(({ from, to }) => `${from}->${to}`)).toEqual([
      'CREATED->VALIDATED',
      'VALIDATED->QUEUED',
      'QUEUED->PREPARING',
      'PREPARING->READY',
      'READY->EXECUTING',
      'EXECUTING->COMPLETED',
    ]);
    expect(created.history).toEqual([]);
  });

  it('rejects illegal and terminal transitions', () => {
    const stateMachine = new ExecutionStateMachine();
    const created = stateMachine.create('execution-one', STARTED_AT);
    expect(() => stateMachine.transition(created, 'EXECUTING', STARTED_AT)).toThrow(
      IllegalExecutionTransitionError,
    );
    const failed = stateMachine.transition(created, 'FAILED', STARTED_AT);
    expect(() => stateMachine.transition(failed, 'QUEUED', STARTED_AT)).toThrow(
      IllegalExecutionTransitionError,
    );
  });

  it('does not expose policy-bypassing requeue from a terminal failure', async () => {
    const service = new ExecutionEngineService();
    const request = await createExecutionRequest();
    const failed = service.fail(
      service.create(request),
      { code: 'TRANSIENT_FAILURE', message: 'Preparation failed.', retryable: true },
      STARTED_AT,
    );
    expect(() => service.enqueue(failed, STARTED_AT)).toThrow(IllegalExecutionTransitionError);
  });

  it('rejects invalid identity, timestamps, and transition reasons', () => {
    const machine = new ExecutionStateMachine();
    expect(() => machine.create('', STARTED_AT)).toThrow('validation failed');
    expect(() => machine.create('execution-one', 'not-a-date')).toThrow('validation failed');
    const created = machine.create('execution-one', STARTED_AT);
    expect(() => machine.transition(created, 'VALIDATED', 'not-a-date')).toThrow(
      'validation failed',
    );
    expect(() => machine.transition(created, 'VALIDATED', STARTED_AT, '  ')).toThrow(
      'validation failed',
    );
  });

  it('rejects a tampered history snapshot before transitioning', async () => {
    const service = new ExecutionEngineService();
    const request = await createExecutionRequest();
    const validated = service.markValidated(service.create(request), STARTED_AT);
    const tampered = { ...validated, attempt: 1 };
    expect(() => service.enqueue(tampered, STARTED_AT)).toThrow('validation failed');
  });

  it.each([[null], [{ schemaVersion: 1 }]])('rejects malformed snapshot shape %#', (snapshot) => {
    expect(() => new ExecutionEngineService().enqueue(snapshot as never, STARTED_AT)).toThrow(
      'validation failed',
    );
  });

  it('rejects corrupted append-only history details', async () => {
    const service = new ExecutionEngineService();
    const request = await createExecutionRequest();
    const validated = service.markValidated(service.create(request), '2026-07-30T18:00:01.000Z');
    const original = validated.history[0];
    expect(original).toBeDefined();
    const variants = [
      { ...validated, schemaVersion: 2 },
      { ...validated, executionId: 'Bad ID' },
      { ...validated, revision: 2 },
      { ...validated, updatedAt: STARTED_AT },
      { ...validated, history: [{ ...original, sequence: 2 }] },
      { ...validated, history: [{ ...original, from: 'QUEUED' }] },
      { ...validated, history: [{ ...original, occurredAt: 'bad' }] },
      { ...validated, history: [{ ...original, reason: ' ' }] },
    ];
    for (const variant of variants) {
      expect(() => service.enqueue(variant as never, validated.updatedAt)).toThrow(
        'validation failed',
      );
    }
  });
});
