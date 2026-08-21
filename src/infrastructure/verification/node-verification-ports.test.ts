import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { BlueprintReaderService } from '../../core/blueprint-reader';
import { createAppliedResult } from '../../core/verification/test/verification.fixture';
import type { VerificationContext, VerificationStagePortResult } from '../../core/verification';
import {
  rejectForbiddenNpmArguments,
  rejectForbiddenShellInvocation,
  validateCommandDescriptorAgainstPolicy,
  VerificationPolicyViolationError,
} from '../../core/verification/policy';
import { NodeFileSystemDocumentSource } from '../blueprint-reader';
import { BoundedStreamCapture } from './bounded-output-capture';
import {
  createNodeVerificationRunners,
  NodeLintRunner,
  NodeProjectValidator,
  SafeVerificationCommandExecutor,
} from './node-verification-ports';
import { SafeVerificationRunner } from './safe-verification-runner';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../core/target-project/test/external-target.fixture';

const context: VerificationContext = {
  fileApplyResult: createAppliedResult(),
  affectedFiles: { created: [], updated: [], deleted: [] },
  metadata: {},
};

describe('Node verification ports', () => {
  it('validates current Project Brain documents through the production reader', async () => {
    const validator = new NodeProjectValidator(
      new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    );
    const result = await validator.validateProject(context);
    expect(result.status).toBe('PASSED');
    expect(result.metadata['document-count']).toBeGreaterThan(0);
  });

  it('maps each stage wrapper to the safe command executor', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-verify-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: { build: 'node -e 0', test: 'node -e 0', lint: 'node -e 0' },
      }),
    );
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 5_000,
      maximumOutputBytes: 4_096,
    });
    const passed: VerificationStagePortResult = {
      status: 'PASSED',
      warnings: [],
      errors: [],
      metadata: {},
    };
    const runDependency = vi
      .spyOn(runners.commandExecutor, 'runDependencyValidation')
      .mockResolvedValue(passed);
    const runBuild = vi.spyOn(runners.commandExecutor, 'runBuild').mockResolvedValue(passed);
    const runTest = vi.spyOn(runners.commandExecutor, 'runTest').mockResolvedValue(passed);

    await runners.dependencyValidator.validateDependencies(context);
    await runners.buildRunner.runBuild(context);
    await runners.testRunner.runTests(context);

    expect(runDependency).toHaveBeenCalled();
    expect(runBuild).toHaveBeenCalled();
    expect(runTest).toHaveBeenCalled();
  });
});

describe('external-target verification stages', () => {
  it('runs lint and typecheck when declared and skips them when absent', async () => {
    const withOptional = createNodeVerificationRunners({
      projectRoot: ZYRO_STYLE_FIXTURE_ROOT,
      commandTimeoutMs: 5_000,
      maximumOutputBytes: 4_096,
    });
    const run = vi.spyOn(withOptional.commandExecutor, 'runNamedScript').mockResolvedValue({
      status: 'PASSED',
      warnings: [],
      errors: [],
      metadata: {},
    });

    await withOptional.lintRunner.runLint(context);
    await withOptional.typecheckRunner.runTypecheck(context);

    expect(run).toHaveBeenCalledWith('lint', 'lint');
    expect(run).toHaveBeenCalledWith('typecheck', 'typecheck');

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
    const lint = await runners.lintRunner.runLint(context);
    expect(lint.status).toBe('SKIPPED');
    expect(lint.warnings.some(({ code }) => code === 'STAGE_SKIPPED')).toBe(true);
    expect(lint.metadata.skipped).toBe(true);
  });

  it('skips build and test when scripts are absent', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-no-build-'));
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: {} }));
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 5_000,
      maximumOutputBytes: 4_096,
    });
    const build = await runners.buildRunner.runBuild(context);
    const test = await runners.testRunner.runTests(context);
    expect(build.status).toBe('SKIPPED');
    expect(test.status).toBe('SKIPPED');
  });

  it('maps lint failures to operator categories', async () => {
    const executor = {
      setExecutionContext: vi.fn(),
      runNamedScript: vi.fn(async () => ({
        status: 'FAILED' as const,
        warnings: [],
        errors: [{ code: 'LINT_FAILED', message: 'failed' }],
        metadata: { 'exit-code': 1 },
      })),
    };
    const lintRunner = new NodeLintRunner(executor as never, {
      hasBuild: true,
      hasTest: true,
      lintScript: 'lint',
      typecheckScript: undefined,
      formatScript: undefined,
    });
    const result = await lintRunner.runLint(context);
    expect(result.errors[0]?.code).toBe('LINT_FAILED');
  });
});

describe('P0-7 safe verification policy', () => {
  it('rejects arbitrary shell commands and executables', () => {
    expect(() => rejectForbiddenShellInvocation('cmd.exe', ['/c', 'echo hi'])).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() => rejectForbiddenShellInvocation('npm', ['-c', 'echo hi'])).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() => rejectForbiddenShellInvocation('git', ['status'])).toThrow(
      VerificationPolicyViolationError,
    );
  });

  it('rejects npm install, npx, and arbitrary script names', () => {
    expect(() => rejectForbiddenNpmArguments(['install'])).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() => rejectForbiddenNpmArguments(['ci'])).toThrow(VerificationPolicyViolationError);
    expect(() => rejectForbiddenNpmArguments(['exec', 'eslint'])).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() =>
      validateCommandDescriptorAgainstPolicy(
        {
          id: 'npm-run-named-script',
          stage: 'BUILD_VALIDATION',
          executableKind: 'npm',
          fixedArguments: ['run', 'deploy'],
          scriptName: 'deploy',
          workingDirectoryPolicy: 'project-root',
          environmentPolicy: 'allowlisted-minimal',
          timeoutMs: 1_000,
          outputLimitBytes: 1_024,
          networkPolicy: 'disabled-unsupported',
        },
        { projectRoot: process.cwd(), stageTimeoutMs: 1_000, outputLimitBytes: 1_024 },
      ),
    ).toThrow(VerificationPolicyViolationError);
  });

  it('bounds stdout and stderr independently during capture', () => {
    const stdout = new BoundedStreamCapture(32);
    const stderr = new BoundedStreamCapture(16);
    stdout.append('a'.repeat(40));
    stderr.append('b'.repeat(40));
    expect(stdout.snapshot().limited).toBe(true);
    expect(stderr.snapshot().limited).toBe(true);
    expect(stdout.snapshot().byteCount).toBeLessThanOrEqual(32);
    expect(stderr.snapshot().byteCount).toBeLessThanOrEqual(16);
  });

  it('does not pass secret environment variables to verification', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'builderai-env-'));
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        scripts: { build: 'node -e "console.log(process.env.OPENAI_API_KEY||\'missing\')"' },
      }),
    );
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'secret-should-not-leak';
    try {
      const executor = new SafeVerificationCommandExecutor({
        projectRoot: root,
        commandTimeoutMs: 30_000,
        maximumOutputBytes: 4_096,
      });
      const result = await executor.runBuild();
      expect(result.status).toBe('PASSED');
      expect(result.diagnostic?.stdoutExcerpt ?? '').not.toContain('secret-should-not-leak');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it('blocks verification when project root equals BuilderAI root', () => {
    const builderRoot = process.cwd();
    expect(
      () =>
        new SafeVerificationRunner({
          projectRoot: builderRoot,
          builderAiRoot: builderRoot,
          stageTimeoutMs: 1_000,
          outputLimitBytes: 1_024,
        }),
    ).toThrow(VerificationPolicyViolationError);
  });
});
