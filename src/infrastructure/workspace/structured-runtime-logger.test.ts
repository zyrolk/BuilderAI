import { StructuredRuntimeLogger } from './structured-runtime-logger';

describe('StructuredRuntimeLogger', () => {
  it('emits bounded structured events without request or credential content', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new StructuredRuntimeLogger();

    logger.record({ correlationId: 'correlation-1', stage: 'PREPARE', outcome: 'STARTED' });
    logger.record({
      correlationId: 'correlation-1',
      stage: 'PREPARE',
      outcome: 'FAILED',
      code: 'INVALID_REQUEST',
    });

    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      component: 'workspace-runtime',
      outcome: 'STARTED',
    });
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      outcome: 'FAILED',
      code: 'INVALID_REQUEST',
    });
    info.mockRestore();
    error.mockRestore();
  });
});
