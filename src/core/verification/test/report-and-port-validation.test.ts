import { describe, expect, it } from 'vitest';

import {
  VerificationEngineService,
  VerificationReportValidator,
  VerificationStagePortResultValidator,
  VerificationValidationError,
} from '..';
import {
  createAppliedResult,
  createDeterministicClock,
  createPortHarness,
} from './verification.fixture';

describe('verification report and port result validation', () => {
  async function createReport() {
    const harness = createPortHarness();
    return new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    ).verify(createAppliedResult());
  }

  it('accepts a generated report', async () => {
    const report = await createReport();
    const validator = new VerificationReportValidator();

    expect(() => validator.validate(report)).not.toThrow();
  });

  it.each([
    [
      'version',
      (report: Awaited<ReturnType<typeof createReport>>) => ({ ...report, schemaVersion: 2 }),
    ],
    [
      'ordering',
      (report: Awaited<ReturnType<typeof createReport>>) => ({
        ...report,
        stages: [...report.stages].reverse(),
      }),
    ],
    [
      'derived status',
      (report: Awaited<ReturnType<typeof createReport>>) => ({ ...report, status: 'FAILED' }),
    ],
    [
      'flattened findings',
      (report: Awaited<ReturnType<typeof createReport>>) => ({
        ...report,
        warnings: [{ stage: 'BUILD_VALIDATION', code: 'EXTRA', message: 'Not in stage' }],
      }),
    ],
    [
      'stage consistency',
      (report: Awaited<ReturnType<typeof createReport>>) => ({
        ...report,
        stages: report.stages.map((stage, index) =>
          index === 0 ? { ...stage, status: 'FAILED', errors: [] } : stage,
        ),
      }),
    ],
  ])('rejects invalid report %s', async (_label, mutate) => {
    const validator = new VerificationReportValidator();
    const invalidReport = mutate(await createReport());

    expect(() => validator.validate(invalidReport)).toThrowError(VerificationValidationError);
  });

  it('rejects duplicate messages and inconsistent status from a port', () => {
    const validator = new VerificationStagePortResultValidator();
    const message = { code: 'DUPLICATE', message: 'Repeated' };

    expect(() =>
      validator.validate({
        status: 'PASSED',
        warnings: [message, message],
        errors: [message],
        metadata: {},
      }),
    ).toThrowError(VerificationValidationError);
  });

  it('rejects invalid stage metadata and finding limits', () => {
    const validator = new VerificationStagePortResultValidator({
      pipeline: [
        'PROJECT_VALIDATION',
        'DEPENDENCY_VALIDATION',
        'BUILD_VALIDATION',
        'TEST_VALIDATION',
        'LINT_VALIDATION',
        'TYPECHECK_VALIDATION',
      ],
      maximumFindingsPerStage: 1,
      maximumFindingMessageCharacters: 3,
      maximumStageMetadataEntries: 1,
      maximumStageMetadataStringCharacters: 3,
      maximumDiagnosticStdoutCharacters: 8_192,
      maximumDiagnosticStderrCharacters: 8_192,
      maximumDiagnosticCombinedCharacters: 16_384,
      maximumReportDiagnosticCharacters: 48_768,
    });

    expect(() =>
      validator.validate({
        status: 'PASSED',
        warnings: [
          { code: 'ONE', message: 'long' },
          { code: 'TWO', message: 'long' },
        ],
        errors: [],
        metadata: { Invalid_Key: 'long', second: true },
      }),
    ).toThrowError(VerificationValidationError);
  });
});
