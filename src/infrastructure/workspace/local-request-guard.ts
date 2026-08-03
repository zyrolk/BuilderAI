const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/** Default workspace request bodies (prepare, apply, etc.). */
export const MAXIMUM_WORKSPACE_BODY_BYTES = 16_384;

/**
 * Feature-plan mutation envelopes must accept a fully populated 16,000-character plan
 * plus bounded wrapper metadata (`plan`, `mode`, etc.).
 */
export const MAXIMUM_FEATURE_PLAN_BODY_BYTES = 17_408;

export class LocalRequestRejectedError extends Error {
  readonly code = 'LOCAL_REQUEST_REJECTED';

  constructor() {
    super('The workspace runtime accepts same-origin loopback requests only.');
    this.name = 'LocalRequestRejectedError';
  }
}

export function assertTrustedLocalRequest(
  request: Request,
  maximumBodyBytes: number = MAXIMUM_WORKSPACE_BODY_BYTES,
): void {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const method = request.method.toUpperCase();
  if (!LOOPBACK_HOSTS.has(url.hostname) || origin === null || origin !== url.origin) {
    throw new LocalRequestRejectedError();
  }
  if (method === 'GET' || method === 'HEAD') {
    return;
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim();
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (
    contentType !== 'application/json' ||
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > maximumBodyBytes
  ) {
    throw new LocalRequestRejectedError();
  }
}

export async function readBoundedJson(
  request: Request,
  maximumBodyBytes: number = MAXIMUM_WORKSPACE_BODY_BYTES,
): Promise<unknown> {
  if (request.body === null) throw new LocalRequestRejectedError();
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBodyBytes) throw new LocalRequestRejectedError();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    if (error instanceof LocalRequestRejectedError) throw error;
    throw new LocalRequestRejectedError();
  } finally {
    reader.releaseLock();
  }
}
