/**
 * @vitest-environment node
 *
 * ADR-052 — ESLint failure parser tests.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { extractBoundedFailureDiagnostics } from '../extract-bounded-failure-diagnostics';

const PROJECT_ROOT = path.resolve('/tmp/builderai-project');

describe('ESLint failure parser (ADR-052)', () => {
  it('extracts stylish format diagnostics', () => {
    const text = [
      'src/app.ts',
      '  10:5  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any',
      '',
    ].join('\n');
    const [diagnostic] = extractBoundedFailureDiagnostics({
      commandId: 'npm-run-lint',
      projectRoot: PROJECT_ROOT,
      diagnosticText: text,
      executionStatus: 'FAILED',
    });
    expect(diagnostic).toMatchObject({
      source: 'ESLINT',
      severity: 'ERROR',
      code: '@typescript-eslint/no-explicit-any',
      relativePath: 'src/app.ts',
      line: 10,
      column: 5,
    });
  });

  it('extracts compact unix-like format', () => {
    const text = 'src/util.ts:3:1: warning: Unused variable (no-unused-vars)';
    const [diagnostic] = extractBoundedFailureDiagnostics({
      commandId: 'npm-run-lint',
      projectRoot: PROJECT_ROOT,
      diagnosticText: text,
      executionStatus: 'FAILED',
    });
    expect(diagnostic).toMatchObject({
      source: 'ESLINT',
      severity: 'WARNING',
      code: 'no-unused-vars',
      relativePath: 'src/util.ts',
      line: 3,
      column: 1,
    });
  });

  it('rejects path attacks', () => {
    expect(
      extractBoundedFailureDiagnostics({
        commandId: 'npm-run-lint',
        projectRoot: PROJECT_ROOT,
        diagnosticText: '../../secret.ts:1:1: error: Nope (x)',
        executionStatus: 'FAILED',
      }),
    ).toHaveLength(0);
  });
});
