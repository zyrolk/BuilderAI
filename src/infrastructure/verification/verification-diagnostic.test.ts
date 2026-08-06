import { describe, expect, it } from 'vitest';

import { buildVerificationDiagnostic } from './verification-diagnostic';

describe('verification-diagnostic', () => {
  it('scenario 6 — truncates very large output deterministically', () => {
    const diagnostic = buildVerificationDiagnostic({
      commandLabel: 'npm test',
      exitCode: 1,
      timedOut: false,
      stdout: 'A'.repeat(20_000),
      stderr: 'B'.repeat(20_000),
      outputBytes: 40_000,
      outputTruncated: true,
      limits: {
        maximumStdoutCharacters: 100,
        maximumStderrCharacters: 100,
        maximumCombinedCharacters: 180,
      },
    });
    expect(diagnostic.truncated).toBe(true);
    expect(diagnostic.stdoutExcerpt?.length ?? 0).toBeLessThanOrEqual(100);
    expect(diagnostic.stderrExcerpt?.length ?? 0).toBeLessThanOrEqual(100);
    expect(diagnostic.stdoutExcerpt).toContain('…');
  });

  it('prefers stderr tail content for failing test output', () => {
    const stderr = `${'noise\n'.repeat(40)}tests/supplierOrder.test.ts:42 Expected PROCESSING but received CANCELLED`;
    const diagnostic = buildVerificationDiagnostic({
      commandLabel: 'npm test',
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr,
      outputBytes: stderr.length,
      outputTruncated: false,
      limits: {
        maximumStdoutCharacters: 8_192,
        maximumStderrCharacters: 8_192,
        maximumCombinedCharacters: 16_384,
      },
    });
    expect(diagnostic.stderrExcerpt).toContain('supplierOrder.test.ts');
  });
});
