/**
 * @vitest-environment node
 *
 * ADR-052 — BoundedFailureDiagnostic validation tests.
 */
import { describe, expect, it } from 'vitest';

import {
  assertNoForbiddenFailureDiagnosticKeys,
  buildBoundedFailureDiagnostic,
  validateBoundedFailureDiagnostic,
} from './bounded-failure-diagnostic.validation';
import { BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION } from './failure-diagnostic.constants';

const PROJECT_ROOT = '/tmp/builderai-project';

describe('BoundedFailureDiagnostic validation (ADR-052)', () => {
  it('accepts a valid diagnostic with path and location', () => {
    const diagnostic = buildBoundedFailureDiagnostic({
      projectRoot: PROJECT_ROOT,
      draft: {
        source: 'TYPESCRIPT',
        commandId: 'npm-run-typecheck',
        severity: 'ERROR',
        code: 'TS2322',
        relativePath: 'src/file.ts',
        line: 12,
        column: 5,
        boundedMessage: 'Type mismatch.',
      },
    });
    expect(diagnostic).toEqual({
      schemaVersion: BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
      source: 'TYPESCRIPT',
      commandId: 'npm-run-typecheck',
      severity: 'ERROR',
      code: 'TS2322',
      relativePath: 'src/file.ts',
      line: 12,
      column: 5,
      boundedMessage: 'Type mismatch.',
    });
    expect(validateBoundedFailureDiagnostic(diagnostic!)).toBe(true);
  });

  it('rejects invalid source and severity', () => {
    expect(
      validateBoundedFailureDiagnostic({
        schemaVersion: BOUNDED_FAILURE_DIAGNOSTIC_SCHEMA_VERSION,
        source: 'UNKNOWN' as never,
        commandId: 'npm-run-lint',
        severity: 'ERROR',
        code: 'x',
      }),
    ).toBe(false);
  });

  it('rejects unsafe paths', () => {
    expect(
      buildBoundedFailureDiagnostic({
        projectRoot: PROJECT_ROOT,
        draft: {
          source: 'ESLINT',
          commandId: 'npm-run-lint',
          severity: 'ERROR',
          relativePath: '../../secret.ts',
          line: 1,
          column: 1,
        },
      }),
    ).toBeUndefined();
  });

  it('rejects invalid line/column when explicitly provided', () => {
    expect(
      buildBoundedFailureDiagnostic({
        projectRoot: PROJECT_ROOT,
        draft: {
          source: 'ESLINT',
          commandId: 'npm-run-lint',
          severity: 'ERROR',
          relativePath: 'src/a.ts',
          line: 0,
          column: 1,
        },
      }),
    ).toBeUndefined();
  });

  it('omits invalid oversized code while retaining location', () => {
    const diagnostic = buildBoundedFailureDiagnostic({
      projectRoot: PROJECT_ROOT,
      draft: {
        source: 'TYPESCRIPT',
        commandId: 'npm-run-typecheck',
        severity: 'ERROR',
        code: 'X'.repeat(100),
        relativePath: 'src/a.ts',
        line: 1,
        column: 1,
      },
    });
    expect(diagnostic?.code).toBeUndefined();
    expect(diagnostic?.relativePath).toBe('src/a.ts');
  });

  it('rejects forbidden diagnostic keys', () => {
    expect(() =>
      assertNoForbiddenFailureDiagnosticKeys({
        source: 'TYPESCRIPT',
        stdout: 'secret',
      }),
    ).toThrow(/Refusing failure diagnostic key "stdout"/);
  });
});
