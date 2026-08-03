import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VERIFICATION_CONFIGURATION,
  VerificationConfigurationValidator,
  VerificationEngineService,
  VerificationReportValidator,
  VerificationStagePortResultValidator,
  VerificationValidationError,
} from '..';
import { createAppliedResult, createPortHarness } from './verification.fixture';

describe('verification input and configuration validation', () => {
  it.each(['REJECTED', 'FAILED'] as const)(
    'rejects a %s File Apply Result (zero mutations) without invoking ports (P1-7)',
    async (status) => {
      const harness = createPortHarness();
      const errors = [{ code: 'INVALID_RESULT' as const, message: 'Apply did not complete' }];
      const input = createAppliedResult({
        status,
        createdFiles: [],
        updatedFiles: [],
        deletedFiles: [],
        skippedFiles: status === 'REJECTED' ? ['src/new.ts'] : [],
        errors,
      });

      await expect(
        new VerificationEngineService(harness.ports).verify(input),
      ).rejects.toMatchObject({
        code: 'VERIFICATION_VALIDATION_FAILED',
        issues: [{ code: 'INVALID_APPLY_RESULT' }],
      });
      expect(harness.calls).toEqual([]);
    },
  );

  it('rejects malformed input without invoking ports', async () => {
    const harness = createPortHarness();

    await expect(
      new VerificationEngineService(harness.ports).verify({ status: 'APPLIED' }),
    ).rejects.toBeInstanceOf(VerificationValidationError);
    expect(harness.calls).toEqual([]);
  });

  it('rejects reordered and incomplete pipelines', () => {
    const validator = new VerificationConfigurationValidator();
    const invalid = {
      ...DEFAULT_VERIFICATION_CONFIGURATION,
      pipeline: ['BUILD_VALIDATION', 'TEST_VALIDATION'],
    };

    expect(() => validator.validate(invalid)).toThrowError(VerificationValidationError);
  });

  it.each([
    ['maximumFindingsPerStage', 0],
    ['maximumFindingMessageCharacters', Number.NaN],
    ['maximumStageMetadataEntries', -1],
    ['maximumStageMetadataStringCharacters', 1.5],
  ] as const)('rejects invalid %s', (key, value) => {
    const validator = new VerificationConfigurationValidator();

    expect(() =>
      validator.validate({ ...DEFAULT_VERIFICATION_CONFIGURATION, [key]: value }),
    ).toThrowError(VerificationValidationError);
  });

  it('rejects unknown configuration properties', () => {
    const validator = new VerificationConfigurationValidator();

    expect(() =>
      validator.validate({ ...DEFAULT_VERIFICATION_CONFIGURATION, surprise: true }),
    ).toThrowError(VerificationValidationError);
  });

  it('rejects invalid configuration at every configurable validation entry point', () => {
    const invalid = { ...DEFAULT_VERIFICATION_CONFIGURATION, maximumFindingsPerStage: 0 };

    expect(() => new VerificationEngineService(createPortHarness().ports, invalid)).toThrowError(
      VerificationValidationError,
    );
    expect(() => new VerificationStagePortResultValidator(invalid)).toThrowError(
      VerificationValidationError,
    );
    expect(() => new VerificationReportValidator(invalid)).toThrowError(
      VerificationValidationError,
    );
  });
});
