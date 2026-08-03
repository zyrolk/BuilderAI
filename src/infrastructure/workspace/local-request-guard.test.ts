import {
  assertTrustedLocalRequest,
  LocalRequestRejectedError,
  readBoundedJson,
} from './local-request-guard';

describe('local workspace request guard', () => {
  it('accepts bounded same-origin JSON requests on loopback', () => {
    const request = new Request('http://localhost:3000/api/workspace/prepare', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: '{}',
    });

    expect(() => assertTrustedLocalRequest(request)).not.toThrow();
  });

  it('accepts trusted local bodyless GET with browser-style headers', () => {
    const request = new Request('http://localhost:3000/api/workspace/feature/plan', {
      method: 'GET',
      headers: { origin: 'http://localhost:3000', Accept: 'application/json' },
    });

    expect(() => assertTrustedLocalRequest(request)).not.toThrow();
  });

  it.each([
    [
      'remote host GET',
      'GET',
      'https://builder.example/api/workspace/feature/plan',
      'https://builder.example',
      undefined,
    ],
    [
      'cross origin GET',
      'GET',
      'http://localhost:3000/api/workspace/feature/plan',
      'http://evil.example',
      undefined,
    ],
    [
      'remote host POST',
      'POST',
      'https://builder.example/api/workspace/prepare',
      'https://builder.example',
      'application/json',
    ],
    [
      'cross origin POST',
      'POST',
      'http://localhost:3000/api/workspace/prepare',
      'http://evil.example',
      'application/json',
    ],
    [
      'non JSON POST',
      'POST',
      'http://localhost:3000/api/workspace/prepare',
      'http://localhost:3000',
      'text/plain',
    ],
  ])('rejects %s', (_case, method, url, origin, contentType) => {
    const headers: Record<string, string> = { origin };
    if (contentType !== undefined) headers['content-type'] = contentType;
    const request = new Request(url, {
      method,
      headers,
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    expect(() => assertTrustedLocalRequest(request)).toThrow(LocalRequestRejectedError);
  });

  it('parses bounded JSON and rejects malformed or oversized streamed bodies', async () => {
    const valid = new Request('http://localhost:3000/api/workspace/prepare', {
      method: 'POST',
      body: JSON.stringify({ request: 'safe' }),
    });
    await expect(readBoundedJson(valid)).resolves.toEqual({ request: 'safe' });

    const malformed = new Request('http://localhost:3000/api/workspace/prepare', {
      method: 'POST',
      body: '{',
    });
    await expect(readBoundedJson(malformed)).rejects.toBeInstanceOf(LocalRequestRejectedError);

    const oversized = new Request('http://localhost:3000/api/workspace/prepare', {
      method: 'POST',
      body: JSON.stringify({ request: 'x'.repeat(17_000) }),
    });
    await expect(readBoundedJson(oversized)).rejects.toBeInstanceOf(LocalRequestRejectedError);
  });
});
