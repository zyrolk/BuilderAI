import { describe, expect, it } from 'vitest';

import { SystemVerificationClockService, VerificationEngineService, VERIFICATION_STAGES } from '..';
import {
  createAppliedResult,
  createDeterministicClock,
  createPortHarness,
} from './verification.fixture';

describe('successful verification', () => {
  it('runs the complete pipeline in canonical order and produces a deterministic report', async () => {
    const harness = createPortHarness({
      PROJECT_VALIDATION: {
        status: 'PASSED',
        warnings: [
          { code: 'Z_WARNING', message: 'Later warning' },
          { code: 'A_WARNING', message: 'Earlier warning' },
        ],
        errors: [],
        metadata: { tool: 'project-validator', attempts: 1 },
      },
    });
    const input = createAppliedResult();

    const report = await new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    ).verify(input);

    expect(harness.calls).toEqual(VERIFICATION_STAGES);
    expect(report.schemaVersion).toBe(1);
    expect(report.status).toBe('PASSED');
    expect(report.stages).toHaveLength(VERIFICATION_STAGES.length);
    expect(report.stages.map(({ stage }) => stage)).toEqual([...VERIFICATION_STAGES]);
    expect(report.stages.every(({ status }) => status === 'PASSED')).toBe(true);
    expect(report.warnings).toEqual([
      {
        stage: 'PROJECT_VALIDATION',
        code: 'A_WARNING',
        message: 'Earlier warning',
      },
      {
        stage: 'PROJECT_VALIDATION',
        code: 'Z_WARNING',
        message: 'Later warning',
      },
    ]);
    expect(report.errors).toEqual([]);
    expect(report.metadata).toEqual({ 'change-id': 'change-11', sprint: 11 });
    expect(report.stages[0]?.warnings).toEqual([
      { code: 'A_WARNING', message: 'Earlier warning' },
      { code: 'Z_WARNING', message: 'Later warning' },
    ]);
    expect(report.stages[0]?.metadata).toEqual({ attempts: 1, tool: 'project-validator' });
  });

  it('supplies isolated, defensive context to every port', async () => {
    const harness = createPortHarness();
    const input = createAppliedResult();
    const engine = new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    );

    await engine.verify(input);

    expect(harness.contexts).toHaveLength(7);
    expect(harness.contexts[0]?.affectedFiles).toEqual({
      created: ['src/new.ts'],
      updated: ['src/existing.ts'],
      deleted: ['src/obsolete.ts'],
    });
    expect(harness.contexts[0]).not.toBe(harness.contexts[1]);
    expect(harness.contexts[0]?.fileApplyResult).not.toBe(input);
    expect(harness.contexts.every(({ metadata }) => metadata['change-id'] === 'change-11')).toBe(
      true,
    );
  });

  it('runs the complete pipeline for a PARTIALLY_APPLIED result (P1-7)', async () => {
    const harness = createPortHarness();
    const input = createAppliedResult({
      status: 'PARTIALLY_APPLIED',
      createdFiles: ['src/new.ts'],
      updatedFiles: [],
      deletedFiles: [],
      skippedFiles: ['src/obsolete.ts'],
      errors: [
        {
          code: 'FILESYSTEM_OPERATION_FAILED',
          message: 'The delete operation failed midway through the plan.',
          logicalPath: 'src/obsolete.ts',
        },
      ],
    });

    const report = await new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    ).verify(input);

    expect(harness.calls).toEqual(VERIFICATION_STAGES);
    expect(report.status).toBe('PASSED');
  });

  it('reports only the actually-mutated files for a PARTIALLY_APPLIED context, never skipped ones (P1-7)', async () => {
    const harness = createPortHarness();
    const input = createAppliedResult({
      status: 'PARTIALLY_APPLIED',
      createdFiles: ['src/new.ts'],
      updatedFiles: ['src/existing.ts'],
      deletedFiles: [],
      skippedFiles: ['src/obsolete.ts'],
      errors: [
        {
          code: 'FILESYSTEM_OPERATION_FAILED',
          message: 'The delete operation failed midway through the plan.',
          logicalPath: 'src/obsolete.ts',
        },
      ],
    });
    const engine = new VerificationEngineService(
      harness.ports,
      undefined,
      createDeterministicClock(),
    );

    await engine.verify(input);

    expect(harness.contexts[0]?.affectedFiles).toEqual({
      created: ['src/new.ts'],
      updated: ['src/existing.ts'],
      deleted: [],
    });
    expect(harness.contexts[0]?.fileApplyResult.skippedFiles).toEqual(['src/obsolete.ts']);
  });

  it('provides a finite non-negative system clock adapter', () => {
    const value = new SystemVerificationClockService().now();

    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  });
});
