import { describe, expect, it } from 'vitest';

import {
  containsSecretLikeVerificationOutput,
  redactVerificationOutput,
} from './verification-output-sanitize';

describe('verification-output-sanitize', () => {
  it('scenario 7 — redacts bearer tokens and env assignments', () => {
    const raw = 'Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz1234567890';
    expect(containsSecretLikeVerificationOutput(raw)).toBe(true);
    expect(redactVerificationOutput(raw)).not.toContain('sk-live');
    expect(redactVerificationOutput('process.env.API_TOKEN=secret-value')).toContain('[REDACTED]');
  });

  it('redacts private key blocks', () => {
    const raw = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----';
    expect(redactVerificationOutput(raw)).toContain('[REDACTED]');
  });
});
