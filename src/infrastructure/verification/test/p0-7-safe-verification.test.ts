import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { VerificationEngineService } from '../../../core/verification';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../../../core/verification';
import {
  createAppliedResult,
  createPortHarness,
} from '../../../core/verification/test/verification.fixture';
import {
  assertArgumentPathSafe,
  assertWorkingDirectoryAllowed,
  buildAllowlistedVerificationEnvironment,
  containsForbiddenVerificationEnvironmentKey,
  rejectForbiddenNpmArguments,
  rejectForbiddenShellInvocation,
  validateCommandDescriptorAgainstPolicy,
  VerificationPolicyViolationError,
} from '../../../core/verification/policy';
import { BoundedStreamCapture } from '../bounded-output-capture';
import { createNodeVerificationRunners } from '../node-verification-ports';
import { SafeVerificationRunner } from '../safe-verification-runner';

function tempProject(scripts: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'builderai-p07-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }));
  return root;
}

describe('P0-7 safe verification runner', () => {
  it('executes an allowed npm verification script', async () => {
    const root = tempProject({ build: 'node -e 0' });
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 30_000,
      maximumOutputBytes: 4_096,
    });
    const result = await runners.buildRunner.runBuild({
      fileApplyResult: createAppliedResult(),
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    expect(result.status).toBe('PASSED');
  }, 30_000);

  it.each([
    ['build', 'runBuild'],
    ['test', 'runTests'],
    ['lint', 'runLint'],
    ['typecheck', 'runTypecheck'],
    ['format', 'runFormat'],
  ] as const)('missing %s script returns SKIPPED', async (kind, method) => {
    const root = tempProject({});
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 30_000,
      maximumOutputBytes: 4_096,
    });
    const context = {
      fileApplyResult: createAppliedResult(),
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    };
    const result =
      kind === 'build'
        ? await runners.buildRunner.runBuild(context)
        : kind === 'test'
          ? await runners.testRunner.runTests(context)
          : kind === 'lint'
            ? await runners.lintRunner.runLint(context)
            : kind === 'typecheck'
              ? await runners.typecheckRunner.runTypecheck(context)
              : await runners.formatRunner.runFormat(context);
    void method;
    expect(result.status).toBe('SKIPPED');
    expect(result.errors).toHaveLength(0);
  });

  it('rejects npm install, npx, git, and arbitrary shell commands', () => {
    expect(() => rejectForbiddenNpmArguments(['install'])).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() => rejectForbiddenNpmArguments(['ci'])).toThrow(VerificationPolicyViolationError);
    expect(() => rejectForbiddenNpmArguments(['update'])).toThrow(VerificationPolicyViolationError);
    expect(() => rejectForbiddenNpmArguments(['exec', 'eslint'])).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() =>
      rejectForbiddenShellInvocation('powershell.exe', ['-Command', 'Get-ChildItem']),
    ).toThrow(VerificationPolicyViolationError);
    expect(() => rejectForbiddenShellInvocation('git.exe', ['commit'])).toThrow(
      VerificationPolicyViolationError,
    );
  });

  it('rejects arbitrary npm script names at policy layer', () => {
    const root = tempProject({ deploy: 'node -e 0' });
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
        { projectRoot: root, stageTimeoutMs: 1_000, outputLimitBytes: 1_024 },
      ),
    ).toThrow(VerificationPolicyViolationError);
  });

  it('rejects working directory and absolute path escapes', () => {
    const root = tempProject();
    expect(() => assertWorkingDirectoryAllowed('/tmp/other', root)).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() => assertArgumentPathSafe('../outside', root)).toThrow(
      VerificationPolicyViolationError,
    );
    expect(() => assertArgumentPathSafe('/outside/file', root)).toThrow(
      VerificationPolicyViolationError,
    );
  });

  it('does not pass provider secret environment variables', () => {
    const env = buildAllowlistedVerificationEnvironment({
      ...process.env,
      OPENAI_API_KEY: 'secret',
      GEMINI_API_KEY: 'secret',
      OPENROUTER_API_KEY: 'secret',
      FIREBASE_PRIVATE_KEY: 'secret',
      BUILDERAI_WORKSPACE_ACCESS_TOKEN: 'secret',
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.FIREBASE_PRIVATE_KEY).toBeUndefined();
    expect(env.BUILDERAI_WORKSPACE_ACCESS_TOKEN).toBeUndefined();
    expect(containsForbiddenVerificationEnvironmentKey(env)).toBeUndefined();
  });

  it('bounds stdout and stderr independently and marks OUTPUT_LIMIT_EXCEEDED', async () => {
    const root = tempProject({
      build:
        "node -e \"process.stdout.write('a'.repeat(5000)); process.stderr.write('b'.repeat(5000)); process.exit(1)\"",
    });
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 30_000,
      maximumOutputBytes: 64,
    });
    const result = await runners.buildRunner.runBuild({
      fileApplyResult: createAppliedResult(),
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    expect(result.status).toBe('OUTPUT_LIMIT_EXCEEDED');
    expect(result.metadata.outputLimited).toBe(true);
  });

  it('terminates on timeout and maps TIMEOUT status', async () => {
    const root = tempProject({ build: 'node -e "setTimeout(()=>{}, 30000)"' });
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 500,
      maximumOutputBytes: 4_096,
    });
    const result = await runners.buildRunner.runBuild({
      fileApplyResult: createAppliedResult(),
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    expect(result.status).toBe('TIMEOUT');
    expect(result.errors.some(({ code }) => code === 'VERIFICATION_COMMAND_TIMEOUT')).toBe(true);
  }, 60_000);

  it('does not start stages after global workflow deadline', async () => {
    const harness = createPortHarness();
    const clock = { now: vi.fn() };
    clock.now.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(700_000);
    const engine = new VerificationEngineService(
      harness.ports,
      {
        ...DEFAULT_VERIFICATION_CONFIGURATION,
        workflowDeadlineMs: 10,
        stageTimeoutMs: 5_000,
      },
      clock,
    );
    const report = await engine.verify(createAppliedResult());
    const unavailable = report.stages.filter(({ status }) => status === 'UNAVAILABLE');
    expect(unavailable.length).toBeGreaterThan(0);
    expect(harness.calls.length).toBeLessThan(7);
  });

  it('maps non-zero exit codes to FAILED', async () => {
    const root = tempProject({ test: 'node -e "process.exit(2)"' });
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 30_000,
      maximumOutputBytes: 4_096,
    });
    const result = await runners.testRunner.runTests({
      fileApplyResult: createAppliedResult(),
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    expect(result.status).toBe('FAILED');
    expect(result.errors[0]?.code).toBe('TEST_FAILED');
  });

  it('does not mutate package.json or lockfiles during dependency validation', async () => {
    const root = tempProject({ build: 'node -e 0' });
    writeFileSync(path.join(root, 'package-lock.json'), '{"lockfileVersion":1}');
    const beforePackage = readFileSync(path.join(root, 'package.json'), 'utf8');
    const beforeLock = readFileSync(path.join(root, 'package-lock.json'), 'utf8');
    const runners = createNodeVerificationRunners({
      projectRoot: root,
      commandTimeoutMs: 30_000,
      maximumOutputBytes: 4_096,
    });
    await runners.dependencyValidator.validateDependencies({
      fileApplyResult: createAppliedResult(),
      affectedFiles: { created: [], updated: [], deleted: [] },
      metadata: {},
    });
    expect(readFileSync(path.join(root, 'package.json'), 'utf8')).toBe(beforePackage);
    expect(readFileSync(path.join(root, 'package-lock.json'), 'utf8')).toBe(beforeLock);
  });

  it('marks policy blocks as POLICY_BLOCKED', () => {
    const root = tempProject({ build: 'node -e 0' });
    expect(
      () =>
        new SafeVerificationRunner({
          projectRoot: root,
          builderAiRoot: root,
          stageTimeoutMs: 1_000,
          outputLimitBytes: 1_024,
        }),
    ).toThrow(VerificationPolicyViolationError);
  });

  it('returns cancelled result when cancellation signal is already set', async () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'builderai-p07-parent-'));
    const builderRoot = path.join(parent, 'builderai');
    const root = path.join(parent, 'target');
    mkdirSync(builderRoot, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e 0' } }),
    );
    const runner = new SafeVerificationRunner({
      projectRoot: root,
      builderAiRoot: builderRoot,
      stageTimeoutMs: 5_000,
      outputLimitBytes: 4_096,
    });
    const cancelled = { cancelled: true, subscribe: () => () => undefined };
    const result = await runner.execute(
      {
        id: 'npm-run-build',
        stage: 'BUILD_VALIDATION',
        executableKind: 'npm',
        fixedArguments: ['run', 'build'],
        scriptName: 'build',
        workingDirectoryPolicy: 'project-root',
        environmentPolicy: 'allowlisted-minimal',
        timeoutMs: 5_000,
        outputLimitBytes: 4_096,
        networkPolicy: 'disabled-unsupported',
      },
      { cancellation: cancelled },
    );
    expect(result.cancelled).toBe(true);
    expect(result.policyBlocked).toBe(false);
  });

  it('returns policy blocked when workflow deadline is already exceeded', async () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'builderai-p07-parent-'));
    const builderRoot = path.join(parent, 'builderai');
    const root = path.join(parent, 'target');
    mkdirSync(builderRoot, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { build: 'node -e 0' } }),
    );
    const runner = new SafeVerificationRunner({
      projectRoot: root,
      builderAiRoot: builderRoot,
      stageTimeoutMs: 5_000,
      outputLimitBytes: 4_096,
    });
    const result = await runner.execute(
      {
        id: 'npm-run-build',
        stage: 'BUILD_VALIDATION',
        executableKind: 'npm',
        fixedArguments: ['run', 'build'],
        scriptName: 'build',
        workingDirectoryPolicy: 'project-root',
        environmentPolicy: 'allowlisted-minimal',
        timeoutMs: 5_000,
        outputLimitBytes: 4_096,
        networkPolicy: 'disabled-unsupported',
      },
      { remainingWorkflowMs: 0 },
    );
    expect(result.policyBlocked).toBe(true);
    expect(result.policyBlockCode).toBe('WORKFLOW_DEADLINE_EXCEEDED');
  });
});

describe('P0-7 output flood capture', () => {
  it('stops accumulating after byte budget without retaining full stream', () => {
    const capture = new BoundedStreamCapture(128);
    capture.append('x'.repeat(10_000));
    const snapshot = capture.snapshot();
    expect(snapshot.limited).toBe(true);
    expect(snapshot.byteCount).toBeLessThanOrEqual(128);
    expect(snapshot.text.length).toBeLessThan(10_000);
  });
});
