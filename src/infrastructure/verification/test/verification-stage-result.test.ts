import { describe, expect, it } from 'vitest';

import {
  descriptorIdForScript,
  mapExecutionToStageResult,
  skippedStageResult,
} from '../verification-stage-result';
import type { SafeVerificationExecutionResult } from '../safe-verification-runner';

const descriptor = {
  id: 'npm-run-build' as const,
  stage: 'BUILD_VALIDATION' as const,
  executableKind: 'npm' as const,
  fixedArguments: ['run', 'build'],
  scriptName: 'build',
  workingDirectoryPolicy: 'project-root' as const,
  environmentPolicy: 'allowlisted-minimal' as const,
  timeoutMs: 1_000,
  outputLimitBytes: 1_024,
  networkPolicy: 'disabled-unsupported' as const,
};

function execution(
  overrides: Partial<SafeVerificationExecutionResult> = {},
): SafeVerificationExecutionResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    cancelled: false,
    policyBlocked: false,
    stdout: '',
    stderr: '',
    stdoutLimited: false,
    stderrLimited: false,
    outputLimited: false,
    ...overrides,
  };
}

describe('mapExecutionToStageResult', () => {
  it('maps passed, failed, timeout, cancelled, and policy statuses', () => {
    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution(),
        failure: { failureCode: 'BUILD_FAILED', message: 'build failed' },
      }).status,
    ).toBe('PASSED');

    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({ exitCode: 1, stderr: 'error' }),
        failure: { failureCode: 'BUILD_FAILED', message: 'build failed' },
      }).errors[0]?.code,
    ).toBe('BUILD_FAILED');

    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({ timedOut: true, exitCode: null }),
        failure: { failureCode: 'BUILD_FAILED', message: 'build failed' },
      }).status,
    ).toBe('TIMEOUT');

    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({ cancelled: true, exitCode: null }),
        failure: { failureCode: 'BUILD_FAILED', message: 'build failed' },
      }).status,
    ).toBe('CANCELLED');

    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({
          policyBlocked: true,
          policyBlockCode: 'FORBIDDEN_EXECUTABLE',
          exitCode: null,
        }),
        failure: { failureCode: 'BUILD_FAILED', message: 'blocked' },
      }).status,
    ).toBe('POLICY_BLOCKED');

    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({
          policyBlocked: true,
          policyBlockCode: 'WORKFLOW_DEADLINE_EXCEEDED',
          exitCode: null,
        }),
        failure: { failureCode: 'BUILD_FAILED', message: 'deadline' },
      }).status,
    ).toBe('UNAVAILABLE');
  });

  it('maps process failure and output limit statuses', () => {
    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({ signal: 'SIGTERM', exitCode: null }),
        failure: { failureCode: 'BUILD_FAILED', message: 'killed' },
      }).status,
    ).toBe('PROCESS_FAILED');

    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({ exitCode: 1, outputLimited: true, stdout: 'x'.repeat(100) }),
        failure: { failureCode: 'BUILD_FAILED', message: 'overflow' },
      }).status,
    ).toBe('OUTPUT_LIMIT_EXCEEDED');

    const truncatedPass = mapExecutionToStageResult({
      descriptor,
      execution: execution({ exitCode: 0, outputLimited: true }),
      failure: { failureCode: 'BUILD_FAILED', message: 'overflow' },
    });
    expect(truncatedPass.status).toBe('PASSED');
    expect(truncatedPass.warnings.some(({ code }) => code === 'OUTPUT_TRUNCATED')).toBe(true);

    expect(
      mapExecutionToStageResult({
        descriptor,
        execution: execution({ exitCode: null }),
        failure: { failureCode: 'BUILD_FAILED', message: 'unknown' },
      }).status,
    ).toBe('PROCESS_FAILED');
  });

  it('returns skipped stage helper and descriptor ids', () => {
    expect(skippedStageResult('build').status).toBe('SKIPPED');
    expect(descriptorIdForScript('lint')).toBe('npm-run-lint');
    expect(descriptorIdForScript('typecheck')).toBe('npm-run-typecheck');
    expect(descriptorIdForScript('format')).toBe('npm-run-format');
  });
});
