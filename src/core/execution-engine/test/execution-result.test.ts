import { ExecutionEngineService, ExecutionResultService, ExecutionResultValidator } from '..';
import { advance, createExecutionRequest } from './execution-engine.fixture';

describe('Execution result', () => {
  it('creates a versioned completed result with placeholders only', async () => {
    const request = await createExecutionRequest();
    const engine = new ExecutionEngineService();
    const completed = advance(engine, engine.create(request), [
      'VALIDATED',
      'QUEUED',
      'PREPARING',
      'READY',
      'EXECUTING',
      'COMPLETED',
    ]);
    const result = new ExecutionResultService().create(completed, {
      diagnostics: [
        { code: 'ORCHESTRATION_COMPLETE', severity: 'INFO', message: 'Lifecycle completed.' },
      ],
      usage: { promptCharacters: request.prompt.budget.characters, estimated: true },
      artifacts: [
        { id: 'artifact-one', name: 'Future output', kind: 'TEXT', state: 'PLACEHOLDER' },
      ],
      metadata: { source: 'test' },
    });
    expect(result).toMatchObject({
      schemaVersion: 1,
      executionId: request.executionId,
      status: 'COMPLETED',
      errors: [],
      timing: { createdAt: request.metadata.requestedAt },
    });
    expect(result.timing.durationMs).toBeGreaterThan(0);
    expect(() => new ExecutionResultValidator().validate(result)).not.toThrow();
  });

  it('requires terminal state and errors for failed results', async () => {
    const request = await createExecutionRequest();
    const engine = new ExecutionEngineService();
    const created = engine.create(request);
    expect(() =>
      new ExecutionResultService().create(created, {
        usage: { promptCharacters: 1, estimated: true },
      }),
    ).toThrow('validation failed');
    const failed = engine.fail(
      created,
      { code: 'VALIDATION_FAILURE', message: 'The request failed validation.', retryable: false },
      request.metadata.requestedAt,
    );
    expect(() =>
      new ExecutionResultService().create(failed, {
        usage: { promptCharacters: 1, estimated: true },
      }),
    ).toThrow('validation failed');
    const result = new ExecutionResultService().create(failed, {
      usage: { promptCharacters: 1, outputCharacters: 0, estimated: true },
      errors: [
        { code: 'VALIDATION_FAILURE', message: 'The request failed validation.', retryable: false },
      ],
    });
    expect(result.status).toBe('FAILED');
  });

  it.each([
    ['non-terminal status', { status: 'EXECUTING' }],
    [
      'inconsistent timing',
      {
        timing: {
          createdAt: '2026-07-30T18:00:00.000Z',
          finishedAt: '2026-07-30T18:00:01.000Z',
          durationMs: 5,
        },
      },
    ],
    [
      'duplicate artifacts',
      {
        artifacts: [
          { id: 'same', name: 'One', kind: 'TEXT', state: 'PLACEHOLDER' },
          { id: 'same', name: 'Two', kind: 'FILE', state: 'PLACEHOLDER' },
        ],
      },
    ],
    [
      'completed errors',
      { errors: [{ code: 'ERROR', message: 'Contradiction', retryable: false }] },
    ],
  ])('rejects %s', async (_name, change) => {
    const request = await createExecutionRequest();
    const engine = new ExecutionEngineService();
    const completed = advance(engine, engine.create(request), [
      'VALIDATED',
      'QUEUED',
      'PREPARING',
      'READY',
      'EXECUTING',
      'COMPLETED',
    ]);
    const valid = new ExecutionResultService().create(completed, {
      usage: { promptCharacters: 10, estimated: true },
    });
    expect(() => new ExecutionResultValidator().validate({ ...valid, ...change })).toThrow(
      'validation failed',
    );
  });

  it('rejects malformed result components and duplicate errors', async () => {
    const validator = new ExecutionResultValidator();
    expect(() => validator.validate(null)).toThrow('validation failed');
    const request = await createExecutionRequest();
    const engine = new ExecutionEngineService();
    const completed = advance(engine, engine.create(request), [
      'VALIDATED',
      'QUEUED',
      'PREPARING',
      'READY',
      'EXECUTING',
      'COMPLETED',
    ]);
    const valid = new ExecutionResultService().create(completed, {
      usage: { promptCharacters: 10, estimated: true },
    });
    const malformed = {
      ...valid,
      schemaVersion: 2,
      executionId: 'Bad ID',
      diagnostics: [{ code: 'bad', severity: 'UNKNOWN', message: '' }, null],
      timing: { createdAt: 'bad', finishedAt: 'bad', durationMs: -1 },
      usage: { promptCharacters: -1, outputCharacters: -1, estimated: 'yes' },
      artifacts: [{ id: 'Bad ID', name: '', kind: 'BINARY', state: 'READY' }, null],
      errors: [
        { code: 'DUPLICATE', message: '', retryable: 'yes' },
        { code: 'DUPLICATE', message: 'Again', retryable: false },
        null,
      ],
      metadata: { nested: {} },
      extra: true,
    };
    expect(() => validator.validate(malformed)).toThrow('validation failed');
    expect(() =>
      validator.validate({
        ...valid,
        diagnostics: null,
        timing: null,
        usage: null,
        artifacts: null,
        errors: null,
      }),
    ).toThrow('validation failed');
  });
});
