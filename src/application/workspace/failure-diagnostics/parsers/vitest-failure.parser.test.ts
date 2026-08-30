/**
 * @vitest-environment node
 *
 * ADR-052 — Vitest failure parser tests.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { extractBoundedFailureDiagnostics } from '../extract-bounded-failure-diagnostics';

const PROJECT_ROOT = path.resolve('/tmp/builderai-project');

describe('Vitest failure parser (ADR-052)', () => {
  it('extracts stack pointer location', () => {
    const text = [
      ' FAIL  src/foo.test.ts > suite',
      'AssertionError: expected true to be false',
      ' ❯ src/foo.test.ts:18:7',
    ].join('\n');
    const [diagnostic] = extractBoundedFailureDiagnostics({
      commandId: 'npm-run-test',
      projectRoot: PROJECT_ROOT,
      diagnosticText: text,
      executionStatus: 'FAILED',
    });
    expect(diagnostic).toMatchObject({
      source: 'VITEST',
      relativePath: 'src/foo.test.ts',
      line: 18,
      column: 7,
      severity: 'ERROR',
    });
  });

  it('extracts direct test file location line', () => {
    const text = 'tests/bar.test.ts:4:2';
    const [diagnostic] = extractBoundedFailureDiagnostics({
      commandId: 'npm-run-test',
      projectRoot: PROJECT_ROOT,
      diagnosticText: text,
      executionStatus: 'FAILED',
    });
    expect(diagnostic?.relativePath).toBe('tests/bar.test.ts');
  });

  it('ignores ambiguous non-source stack lines', () => {
    const text = [' ❯ node:internal/process/task_queues:95:5', 'some random log line'].join('\n');
    expect(
      extractBoundedFailureDiagnostics({
        commandId: 'npm-run-test',
        projectRoot: PROJECT_ROOT,
        diagnosticText: text,
        executionStatus: 'FAILED',
      }),
    ).toHaveLength(0);
  });
});
