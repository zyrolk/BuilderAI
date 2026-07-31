import type { ArtifactChecksumPort } from '../ports';
import { ResponseProcessorValidationError } from '../types';

export class Sha256ChecksumService implements ArtifactChecksumPort {
  readonly algorithm = 'sha256';

  async checksum(content: string): Promise<string> {
    if (globalThis.crypto?.subtle === undefined) {
      throw new ResponseProcessorValidationError([
        {
          code: 'INVALID_CONFIGURATION',
          path: '$.checksum',
          message: 'SHA-256 requires the Web Crypto API',
        },
      ]);
    }
    const bytes = new TextEncoder().encode(content);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }
}
