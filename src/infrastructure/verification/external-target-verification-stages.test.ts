import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { VerificationStagePortResult } from '../../core/verification';
import { createNodeVerificationRunners, NodeLintRunner } from './node-verification-ports';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../core/target-project/test/external-target.fixture';

const PASSED: VerificationStagePortResult = {
  status: 'PASSED',
  warnings: [],
  errors: [],
  metadata: {},
};

describe('external-target verification stages', () => {
  it('runs lint and typecheck when declared and skips them when absent', async () => {
    const withOptional = createNodeVerificationRunners({
      projectRoot: ZYRO_STYLE_FIXTURE_ROOT,
      commandTimeoutMs: 5_000,
      maximumOutputBytes: 4_096,
    });
    const run = vi.spyOn(withOptional.commandRunner, 'run').mockResolvedValue(PASSED);

    await withOptional.lintRunner.runLint({
      fileApplyResult: {
        schemaVersion: 1 as const,
        status: 'APPLIED',
        createdFiles: [],
        updatedFiles: [],
        deletedFiles: [],
        skippedFiles: [],
        warnings: [],
        errors: [],
        durationMs: 1,
        metadata: {},
      },
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    await withOptional.typecheckRunner.runTypecheck({
      fileApplyResult: {
        schemaVersion: 1 as const,
        status: 'APPLIED',
        createdFiles: [],
        updatedFiles: [],
        deletedFiles: [],
        skippedFiles: [],
        warnings: [],
        errors: [],
        durationMs: 1,
        metadata: {},
      },
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });

    expect(run).toHaveBeenCalledWith('lint-validation', ['run', 'lint'], {
      failureCode: 'LINT_FAILED',
      commandLabel: 'npm run lint',
    });
    expect(run).toHaveBeenCalledWith('typecheck-validation', ['run', 'typecheck'], {
      failureCode: 'TYPECHECK_FAILED',
      commandLabel: 'npm run typecheck',
    });

    const root = mkdtempSync(path.join(tmpdir(), 'builderai-no-lint-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e 0', test: 'node -e 0' } }),
    );
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 5_000,
      maximumOutputBytes: 4_096,
    });
    const lint = await runners.lintRunner.runLint({
      fileApplyResult: {
        schemaVersion: 1 as const,
        status: 'APPLIED',
        createdFiles: [],
        updatedFiles: [],
        deletedFiles: [],
        skippedFiles: [],
        warnings: [],
        errors: [],
        durationMs: 1,
        metadata: {},
      },
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    expect(lint.status).toBe('PASSED');
    expect(lint.warnings.some(({ code }) => code === 'STAGE_SKIPPED')).toBe(true);
    expect(lint.metadata.skipped).toBe(true);
  });

  it('maps build and test failures to operator categories', async () => {
    const runner = {
      run: vi.fn(
        async (_stage: string, _args: readonly string[], options: { failureCode: string }) => ({
          status: 'FAILED' as const,
          warnings: [],
          errors: [{ code: options.failureCode, message: 'failed' }],
          metadata: { 'exit-code': 1 },
        }),
      ),
    };
    const lintRunner = new NodeLintRunner(runner as never, {
      hasBuild: true,
      hasTest: true,
      lintScript: 'lint',
      typecheckScript: undefined,
    });
    const context = {
      fileApplyResult: {
        schemaVersion: 1 as const,
        status: 'APPLIED' as const,
        createdFiles: [],
        updatedFiles: [],
        deletedFiles: [],
        skippedFiles: [],
        warnings: [],
        errors: [],
        durationMs: 1,
        metadata: {},
      },
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    };
    const result = await lintRunner.runLint(context);
    expect(result.errors[0]?.code).toBe('LINT_FAILED');
  });
});
