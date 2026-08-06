import { describe, expect, it } from 'vitest';

import { VerificationEngineService } from '../../core/verification';
import { createAppliedResult } from '../../core/verification/test/verification.fixture';
import type { VerificationStagePortResult } from '../../core/verification';
import { buildVerificationDiagnostic } from './verification-diagnostic';
import { redactVerificationOutput } from './verification-output-sanitize';

function failedStage(
  code: string,
  stderr: string,
  commandLabel: string,
): VerificationStagePortResult {
  return {
    status: 'FAILED',
    warnings: [],
    errors: [{ code, message: `${code} message` }],
    metadata: { 'exit-code': 1, 'output-bytes': stderr.length, 'output-truncated': false },
    diagnostic: buildVerificationDiagnostic({
      commandLabel,
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
    }),
  };
}

describe('CP9 verification diagnostic scenarios', () => {
  it('scenario 1 — build failure diagnostic retains compiler stderr excerpt', async () => {
    const report = await new VerificationEngineService({
      projectValidator: { validateProject: async () => PASSED },
      dependencyValidator: { validateDependencies: async () => PASSED },
      buildRunner: {
        runBuild: async () =>
          failedStage(
            'BUILD_FAILED',
            "error TS2322: Type 'string' is not assignable to type 'number'.",
            'npm run build',
          ),
      },
      testRunner: { runTests: async () => PASSED },
      lintRunner: { runLint: async () => PASSED },
      typecheckRunner: { runTypecheck: async () => PASSED },
    }).verify(createAppliedResult());
    const stage = report.stages.find(({ stage }) => stage === 'BUILD_VALIDATION');
    expect(stage?.diagnostic?.stderrExcerpt).toContain('TS2322');
    expect(stage?.diagnostic?.commandLabel).toBe('npm run build');
  });

  it('scenario 2 — test failure diagnostic retains failing test excerpt', async () => {
    const report = await new VerificationEngineService({
      projectValidator: { validateProject: async () => PASSED },
      dependencyValidator: { validateDependencies: async () => PASSED },
      buildRunner: { runBuild: async () => PASSED },
      testRunner: {
        runTests: async () =>
          failedStage(
            'TEST_FAILED',
            'FAIL tests/supplierOrder.test.ts\nExpected PROCESSING but received CANCELLED',
            'npm test',
          ),
      },
      lintRunner: { runLint: async () => PASSED },
      typecheckRunner: { runTypecheck: async () => PASSED },
    }).verify(createAppliedResult());
    const stage = report.stages.find(({ stage }) => stage === 'TEST_VALIDATION');
    expect(stage?.diagnostic?.stderrExcerpt).toContain('supplierOrder.test.ts');
  });

  it('scenario 3 — lint failure diagnostic retains lint error excerpt', async () => {
    const report = await new VerificationEngineService({
      projectValidator: { validateProject: async () => PASSED },
      dependencyValidator: { validateDependencies: async () => PASSED },
      buildRunner: { runBuild: async () => PASSED },
      testRunner: { runTests: async () => PASSED },
      lintRunner: {
        runLint: async () =>
          failedStage(
            'LINT_FAILED',
            'src/app.ts:12:5 error Unexpected console statement  no-console',
            'npm run lint',
          ),
      },
      typecheckRunner: { runTypecheck: async () => PASSED },
    }).verify(createAppliedResult());
    const stage = report.stages.find(({ stage }) => stage === 'LINT_VALIDATION');
    expect(stage?.diagnostic?.stderrExcerpt).toContain('no-console');
  });

  it('scenario 4 — typecheck failure diagnostic retains compiler excerpt', async () => {
    const report = await new VerificationEngineService({
      projectValidator: { validateProject: async () => PASSED },
      dependencyValidator: { validateDependencies: async () => PASSED },
      buildRunner: { runBuild: async () => PASSED },
      testRunner: { runTests: async () => PASSED },
      lintRunner: { runLint: async () => PASSED },
      typecheckRunner: {
        runTypecheck: async () =>
          failedStage(
            'TYPECHECK_FAILED',
            "src/types.ts(4,11): error TS2304: Cannot find name 'MissingType'.",
            'npm run typecheck',
          ),
      },
    }).verify(createAppliedResult());
    const stage = report.stages.find(({ stage }) => stage === 'TYPECHECK_VALIDATION');
    expect(stage?.diagnostic?.stderrExcerpt).toContain('TS2304');
  });

  it('scenario 5 — successful stages omit diagnostic excerpts', async () => {
    const report = await new VerificationEngineService({
      projectValidator: { validateProject: async () => PASSED },
      dependencyValidator: { validateDependencies: async () => PASSED },
      buildRunner: { runBuild: async () => PASSED },
      testRunner: { runTests: async () => PASSED },
      lintRunner: { runLint: async () => PASSED },
      typecheckRunner: { runTypecheck: async () => PASSED },
    }).verify(createAppliedResult());
    expect(report.stages.every(({ diagnostic }) => diagnostic === undefined)).toBe(true);
  });

  it('scenario 7 — secret-like stderr is redacted in diagnostic excerpts', () => {
    const diagnostic = buildVerificationDiagnostic({
      commandLabel: 'npm test',
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: 'Authorization: Bearer sk-live-abcdefghijklmnopqrstuvwxyz1234567890',
      outputBytes: 64,
      outputTruncated: false,
      limits: {
        maximumStdoutCharacters: 8_192,
        maximumStderrCharacters: 8_192,
        maximumCombinedCharacters: 16_384,
      },
    });
    expect(diagnostic.stderrExcerpt).not.toContain('sk-live');
    expect(redactVerificationOutput(diagnostic.stderrExcerpt ?? '')).toContain('[REDACTED]');
  });

  it('scenario 8 — timeout diagnostics omit exit code and mark truncated state', () => {
    const diagnostic = buildVerificationDiagnostic({
      commandLabel: 'npm run build',
      exitCode: null,
      timedOut: true,
      stdout: 'building…',
      stderr: '',
      outputBytes: 32,
      outputTruncated: false,
      limits: {
        maximumStdoutCharacters: 8_192,
        maximumStderrCharacters: 8_192,
        maximumCombinedCharacters: 16_384,
      },
    });
    expect(diagnostic.exitCode).toBeUndefined();
    expect(diagnostic.truncated).toBe(false);
  });

  it('scenario 9 — infrastructure failure category remains distinct from command failure', async () => {
    const report = await new VerificationEngineService({
      projectValidator: { validateProject: async () => PASSED },
      dependencyValidator: {
        validateDependencies: async () => {
          throw new Error('spawn failed');
        },
      },
      buildRunner: { runBuild: async () => PASSED },
      testRunner: { runTests: async () => PASSED },
      lintRunner: { runLint: async () => PASSED },
      typecheckRunner: { runTypecheck: async () => PASSED },
    }).verify(createAppliedResult());
    expect(report.stages[1]?.errors[0]?.code).toBe('STAGE_EXECUTION_FAILED');
    expect(report.stages[1]?.diagnostic).toBeUndefined();
  });
});

const PASSED: VerificationStagePortResult = {
  status: 'PASSED',
  warnings: [],
  errors: [],
  metadata: {},
};
