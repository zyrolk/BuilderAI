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

  it.each([
    [
      'remote host',
      'https://builder.example/api/workspace/prepare',
      'https://builder.example',
      'application/json',
    ],
    [
      'cross origin',
      'http://localhost:3000/api/workspace/prepare',
      'http://evil.example',
      'application/json',
    ],
    [
      'non JSON',
      'http://localhost:3000/api/workspace/prepare',
      'http://localhost:3000',
      'text/plain',
    ],
  ])('rejects %s', (_case, url, origin, contentType) => {
    const request = new Request(url, {
      method: 'POST',
      headers: { origin, 'content-type': contentType },
      body: '{}',
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
