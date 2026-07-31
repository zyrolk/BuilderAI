import {
  ProviderContractService,
  ProviderContractViolationError,
  ProviderResponseValidator,
} from '..';
import { createRequest, createResponse } from './ai-provider.fixture';

describe('provider response validation', () => {
  it('rejects a non-object response boundary', () => {
    expect(() => new ProviderResponseValidator().validate(null)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('accepts typed artifacts, diagnostics, warnings, statistics, and usage', () => {
    const response = createResponse({
      artifacts: [
        { id: 'text', name: 'text', kind: 'TEXT', content: 'result' },
        { id: 'data', name: 'data', kind: 'STRUCTURED_DATA', data: { valid: true } },
        {
          id: 'file',
          name: 'file',
          kind: 'FILE',
          path: 'output/result.txt',
          mediaType: 'text/plain',
          content: 'result',
        },
        { id: 'image', name: 'image', kind: 'IMAGE', mediaType: 'image/png', data: 'data' },
      ],
      diagnostics: [{ code: 'DETAIL', severity: 'INFO', message: 'Validated' }],
      warnings: [{ code: 'LIMIT', message: 'Output was bounded.' }],
      usage: {
        inputCharacters: 1_000,
        promptCharacters: 900,
        outputCharacters: 12,
        artifactCount: 4,
      },
    });
    expect(() => new ProviderResponseValidator().validate(response)).not.toThrow();
  });

  it('requires an error diagnostic for failed responses', () => {
    expect(() =>
      new ProviderResponseValidator().validate(
        createResponse({
          status: 'FAILED',
          artifacts: [],
          usage: { ...createResponse().usage, artifactCount: 0 },
        }),
      ),
    ).toThrow(ProviderContractViolationError);
  });

  it('rejects duplicate artifacts, invalid JSON data, and inconsistent usage', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const response = createResponse({
      artifacts: [
        { id: 'same', name: 'one', kind: 'TEXT', content: 'one' },
        { id: 'same', name: 'two', kind: 'STRUCTURED_DATA', data: cyclic as never },
      ],
    });
    expect(() => new ProviderResponseValidator().validate(response)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('rejects timing and completed/error contradictions', () => {
    const response = createResponse({
      diagnostics: [{ code: 'FAIL', severity: 'ERROR', message: 'failure' }],
      statistics: {
        startedAt: '2026-07-30T16:00:02.000Z',
        completedAt: 'invalid',
        durationMs: -1,
      },
    });
    expect(() => new ProviderResponseValidator().validate(response)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('rejects malformed response collection and statistics shapes', () => {
    const response = {
      ...createResponse(),
      contractVersion: 2,
      requestId: 'Invalid ID',
      status: 'UNKNOWN',
      artifacts: null,
      diagnostics: null,
      warnings: null,
      statistics: null,
      usage: null,
      metadata: null,
    };
    expect(() => new ProviderResponseValidator().validate(response)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('rejects unsafe files and malformed diagnostics, warnings, and artifacts', () => {
    const response = createResponse({
      artifacts: [
        null as never,
        { id: '', name: '', kind: 'UNKNOWN' } as never,
        {
          id: 'unsafe-file',
          name: 'unsafe',
          kind: 'FILE',
          path: '../outside',
          mediaType: '',
          content: 1 as never,
        },
        { id: 'bad-image', name: 'image', kind: 'IMAGE', mediaType: '', data: '' },
      ],
      diagnostics: [
        null as never,
        { code: '', severity: 'UNKNOWN' as never, message: '', path: '' },
      ],
      warnings: [null as never, { code: '', message: '' }],
      usage: { ...createResponse().usage, artifactCount: 4 },
    });
    expect(() => new ProviderResponseValidator().validate(response)).toThrow(
      ProviderContractViolationError,
    );
  });

  it('validates response identity, limits, prompt usage, and required artifacts as an exchange', async () => {
    const request = await createRequest();
    const response = createResponse({
      requestId: request.requestId,
      usage: {
        ...createResponse().usage,
        promptCharacters: request.prompt.budget.characters,
      },
    });
    const service = new ProviderContractService();
    expect(() => service.validateExchange(request, response)).not.toThrow();

    expect(() =>
      service.validateExchange(request, {
        ...response,
        requestId: 'wrong-request',
        artifacts: [],
        usage: {
          ...response.usage,
          promptCharacters: request.prompt.budget.characters + 1,
          outputCharacters: request.constraints.maximumOutputCharacters + 1,
          artifactCount: 0,
        },
      }),
    ).toThrow(ProviderContractViolationError);
  });
});
