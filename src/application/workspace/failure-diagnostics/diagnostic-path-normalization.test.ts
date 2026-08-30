/**
 * @vitest-environment node
 *
 * ADR-052 — diagnostic path normalization tests.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { normalizeFailureDiagnosticRelativePath } from './diagnostic-path-normalization';

const PROJECT_ROOT = path.resolve('/tmp/builderai-project');

describe('normalizeFailureDiagnosticRelativePath (ADR-052)', () => {
  it('accepts safe nested workspace paths', () => {
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: 'src/nested/file.ts',
        projectRoot: PROJECT_ROOT,
      }),
    ).toBe('src/nested/file.ts');
  });

  it('normalizes mixed slashes', () => {
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: 'src\\nested\\file.ts',
        projectRoot: PROJECT_ROOT,
      }),
    ).toBe('src/nested/file.ts');
  });

  it('converts absolute paths inside project root', () => {
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: path.join(PROJECT_ROOT, 'src/file.ts'),
        projectRoot: PROJECT_ROOT,
      }),
    ).toBe('src/file.ts');
  });

  it('rejects traversal and outside-root paths', () => {
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: '../../secret.ts',
        projectRoot: PROJECT_ROOT,
      }),
    ).toBeUndefined();
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: '../outside.ts',
        projectRoot: PROJECT_ROOT,
      }),
    ).toBeUndefined();
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: 'C:\\Windows\\secret.ts',
        projectRoot: PROJECT_ROOT,
      }),
    ).toBeUndefined();
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: '\\\\server\\share\\secret.ts',
        projectRoot: PROJECT_ROOT,
      }),
    ).toBeUndefined();
    expect(
      normalizeFailureDiagnosticRelativePath({
        rawPath: '/etc/passwd',
        projectRoot: PROJECT_ROOT,
      }),
    ).toBeUndefined();
  });
});
