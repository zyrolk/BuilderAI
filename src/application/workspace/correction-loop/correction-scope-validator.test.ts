import { describe, expect, it } from 'vitest';

import type { ProjectChangePlan } from '../../../core/change-planner';
import { CHANGE_PLAN, CORRECTED_CHANGE_PLAN } from '../../../ui/workspace/test/workspace.fixture';
import { buildCorrectionDiagnostic } from './correction-diagnostic.service';
import { classifyCorrectionFailure } from './correction-failure-classifier';
import type { CorrectionLoopBeginInput } from './correction-loop.types';
import { validateCorrectionChangePlanScope } from './correction-scope-validator';

function diagnosticFor(path: string) {
  const input: CorrectionLoopBeginInput = {
    workflowId: 'wf-scope',
    applyStatus: 'APPLIED',
    createdPaths: [],
    updatedPaths: [path],
    deletedPaths: [],
    verificationReport: {
      status: 'FAILED',
      stages: [
        {
          stage: 'BUILD_VALIDATION',
          status: 'FAILED',
          errors: [{ code: 'BUILD_FAILED', message: `Error in ${path}` }],
        },
      ],
      errors: [],
    },
  };
  return buildCorrectionDiagnostic({
    workflowId: 'wf-scope',
    attempt: 1,
    classification: classifyCorrectionFailure(input),
    beginInput: input,
  });
}

describe('correction ChangePlan scope validator', () => {
  it('accepts an exact evidenced file', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const result = validateCorrectionChangePlanScope({
      diagnostic,
      changePlan: CHANGE_PLAN,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an evidence-supported related test file', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const plan: ProjectChangePlan = {
      ...CHANGE_PLAN,
      changeSet: {
        operations: [
          {
            ...CHANGE_PLAN.changeSet.operations[0]!,
            logicalPath: 'src/example.test.ts',
            operationId: 'op-update-example-test',
          },
        ],
      },
    };
    const result = validateCorrectionChangePlanScope({ diagnostic, changePlan: plan });
    expect(result.ok).toBe(true);
  });

  it('rejects an unrelated file', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const plan: ProjectChangePlan = {
      ...CHANGE_PLAN,
      changeSet: {
        operations: [
          {
            ...CHANGE_PLAN.changeSet.operations[0]!,
            logicalPath: 'src/unrelated.ts',
            operationId: 'op-update-unrelated',
          },
        ],
      },
    };
    const result = validateCorrectionChangePlanScope({ diagnostic, changePlan: plan });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('CORRECTION_SCOPE_VIOLATION');
      expect(result.rejectedPaths).toContain('src/unrelated.ts');
    }
  });

  it('rejects protected paths', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const plan: ProjectChangePlan = {
      ...CHANGE_PLAN,
      changeSet: {
        operations: [
          {
            ...CHANGE_PLAN.changeSet.operations[0]!,
            logicalPath: '.env.local',
            operationId: 'op-update-env',
          },
        ],
      },
    };
    const result = validateCorrectionChangePlanScope({ diagnostic, changePlan: plan });
    expect(result.ok).toBe(false);
  });

  it('rejects CREATE outside scope', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const result = validateCorrectionChangePlanScope({
      diagnostic,
      changePlan: CORRECTED_CHANGE_PLAN,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects DELETE outside scope', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const plan: ProjectChangePlan = {
      ...CHANGE_PLAN,
      changeSet: {
        operations: [
          {
            kind: 'DELETE_FILE',
            operationId: 'op-delete-other',
            logicalPath: 'src/other.ts',
            artifactType: 'SOURCE_FILE',
            description: 'Delete other',
            sourceChecksum: CHANGE_PLAN.changeSet.operations[0]!.sourceChecksum,
            sourceSizeBytes: 1,
          },
        ],
      },
    };
    const result = validateCorrectionChangePlanScope({ diagnostic, changePlan: plan });
    expect(result.ok).toBe(false);
  });

  it('rejects multi-file scope expansion', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const result = validateCorrectionChangePlanScope({
      diagnostic,
      changePlan: {
        ...CHANGE_PLAN,
        changeSet: {
          operations: [
            ...CHANGE_PLAN.changeSet.operations,
            {
              ...CHANGE_PLAN.changeSet.operations[0]!,
              logicalPath: 'src/extra.ts',
              operationId: 'op-update-extra',
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts explicitly authorized original task paths', () => {
    const diagnostic = diagnosticFor('src/example.ts');
    const result = validateCorrectionChangePlanScope({
      diagnostic,
      changePlan: CORRECTED_CHANGE_PLAN,
      explicitlyAuthorizedPaths: ['src/example-corrected.ts'],
    });
    expect(result.ok).toBe(true);
  });
});
