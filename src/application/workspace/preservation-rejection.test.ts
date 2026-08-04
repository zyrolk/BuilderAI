import { createOperationId, type ProjectChangePlan } from '../../core/change-planner';
import {
  buildIterationFeedbackFromGate2Rejection,
  normalizeIterationFeedback,
  serializedIterationFeedbackLength,
} from './iteration-feedback.service';
import { ITERATION_FEEDBACK_LIMITS } from './iteration-feedback.types';
import {
  buildPreservationRejectionFromChangePlan,
  isElevatedChurnRatio,
  isHighChurnRatio,
} from './preservation-rejection-builder.service';
import {
  SMOKE_031_OPERATOR_REASON,
  SMOKE_031_REJECTED_CHANGE_PLAN,
  SMOKE_031_REJECTED_PREPARATION_ID,
} from './test/smoke-031-preservation-rejection.fixture';

import type { UpdateFileOperation, UpdatePreservationAssessment } from '../../core/change-planner';

function createUpdateOperation(
  logicalPath: string,
  preservation: UpdatePreservationAssessment,
): UpdateFileOperation {
  return {
    operationId: createOperationId('UPDATE_FILE', logicalPath),
    kind: 'UPDATE_FILE',
    logicalPath,
    artifactType: 'SOURCE_FILE',
    description: `Update ${logicalPath}.`,
    sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
    sourceSizeBytes: 100,
    content: 'updated content omitted',
    preservation,
  };
}

function createPlan(
  operations: ProjectChangePlan['changeSet']['operations'],
  metadata: ProjectChangePlan['metadata'] = {},
  warnings: ProjectChangePlan['warnings'] = [],
): ProjectChangePlan {
  return {
    schemaVersion: 1,
    source: { responsePackageSchemaVersion: 1, executionId: 'execution-preservation-test' },
    changeSet: { operations },
    summary: {
      filesCreated: [],
      filesUpdated: operations
        .filter((operation) => operation.kind === 'UPDATE_FILE')
        .map(({ logicalPath }) => logicalPath),
      filesDeleted: [],
      totalOperations: operations.length,
      warnings: [],
    },
    risks: [],
    warnings,
    metadata,
  };
}

describe('Preservation rejection builder (ADR-031 Slice 2)', () => {
  it('extracts HIGH churn from preservation metadata', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_HIGH_CHURN_REWRITE',
            severity: 'HIGH',
            message: 'High churn rewrite.',
          },
        ],
        churnRatio: 1,
        similarityRatio: 0,
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.churnRatio).toBe(1);
    expect(isHighChurnRatio(rejection?.operations[0]?.churnRatio)).toBe(true);
    expect(rejection?.operations[0]?.findingCodes).toEqual(['PRESERVATION_HIGH_CHURN_REWRITE']);
  });

  it('extracts ELEVATED churn from preservation metadata', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_ELEVATED_CHURN',
            severity: 'MEDIUM',
            message: 'Elevated churn.',
          },
        ],
        churnRatio: 0.55,
        similarityRatio: 0.45,
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(isElevatedChurnRatio(rejection?.operations[0]?.churnRatio)).toBe(true);
    expect(rejection?.operations[0]?.findingCodes).toEqual(['PRESERVATION_ELEVATED_CHURN']);
  });

  it('extracts removed HTML IDs in sorted order', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_REMOVED_HTML_ID',
            severity: 'HIGH',
            message: 'Removed ids.',
          },
        ],
        removedHtmlIds: ['next-quote', 'increment-counter', 'reset-counter'],
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.removedHtmlIds).toEqual([
      'increment-counter',
      'next-quote',
      'reset-counter',
    ]);
  });

  it('extracts removed aria attributes in sorted order', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
            severity: 'HIGH',
            message: 'Removed aria.',
          },
        ],
        removedAccessibilityAttributes: ['aria-describedby', 'aria-live'],
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.removedAccessibilityAttributes).toEqual([
      'aria-describedby',
      'aria-live',
    ]);
  });

  it('extracts cross-file reference risks as id@path strings', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
            severity: 'HIGH',
            message: 'Cross-file risk.',
          },
        ],
        crossFileReferenceRisks: [
          { removedId: 'reset-counter', referencingLogicalPath: 'assets/app.js' },
          { removedId: 'increment-counter', referencingLogicalPath: 'assets/app.js' },
        ],
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.crossFileReferenceRisks).toEqual([
      'increment-counter@assets/app.js',
      'reset-counter@assets/app.js',
    ]);
  });

  it('summarizes multiple operations sorted by logicalPath', () => {
    const plan = createPlan([
      createUpdateOperation('assets/styles.css', {
        findings: [
          {
            code: 'PRESERVATION_ELEVATED_CHURN',
            severity: 'MEDIUM',
            message: 'Elevated churn.',
          },
        ],
        churnRatio: 0.5,
      }),
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_HIGH_CHURN_REWRITE',
            severity: 'HIGH',
            message: 'High churn.',
          },
        ],
        churnRatio: 0.95,
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations.map(({ logicalPath }) => logicalPath)).toEqual([
      'assets/styles.css',
      'index.html',
    ]);
  });

  it('caps operations at eight', () => {
    const operations = Array.from({ length: 12 }, (_, index) =>
      createUpdateOperation(`src/file-${index}.html`, {
        findings: [
          {
            code: 'PRESERVATION_ELEVATED_CHURN',
            severity: 'MEDIUM',
            message: 'Elevated churn.',
          },
        ],
        churnRatio: 0.5,
      }),
    );
    const rejection = buildPreservationRejectionFromChangePlan(createPlan(operations));
    expect(rejection?.operations).toHaveLength(8);
  });

  it('deduplicates finding codes and sorts deterministically', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_REMOVED_HTML_ID',
            severity: 'HIGH',
            message: 'Removed ids.',
          },
          {
            code: 'PRESERVATION_HIGH_CHURN_REWRITE',
            severity: 'HIGH',
            message: 'High churn.',
          },
          {
            code: 'PRESERVATION_REMOVED_HTML_ID',
            severity: 'HIGH',
            message: 'Duplicate code.',
          },
        ],
        churnRatio: 1,
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.findingCodes).toEqual([
      'PRESERVATION_HIGH_CHURN_REWRITE',
      'PRESERVATION_REMOVED_HTML_ID',
    ]);
  });

  it('includes bounded operator reason', () => {
    const rejection = buildPreservationRejectionFromChangePlan(SMOKE_031_REJECTED_CHANGE_PLAN, {
      operatorReason: SMOKE_031_OPERATOR_REASON,
    });
    expect(rejection?.operatorReason).toBe(SMOKE_031_OPERATOR_REASON);
    expect(rejection?.operatorReason?.length).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_OPERATOR_REASON,
    );
  });

  it('truncates oversized operator reason to 240 characters', () => {
    const rejection = buildPreservationRejectionFromChangePlan(SMOKE_031_REJECTED_CHANGE_PLAN, {
      operatorReason: 'x'.repeat(400),
    });
    expect(rejection?.operatorReason).toHaveLength(240);
  });

  it('returns undefined for legacy ChangePlan without preservation metadata', () => {
    const plan = createPlan([
      {
        operationId: createOperationId('CREATE_FILE', 'src/new.ts'),
        kind: 'CREATE_FILE',
        logicalPath: 'src/new.ts',
        artifactType: 'SOURCE_FILE',
        description: 'Create file.',
        sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
        sourceSizeBytes: 10,
        content: 'export const created = true;\n',
      },
    ]);
    expect(buildPreservationRejectionFromChangePlan(plan)).toBeUndefined();
  });

  it('returns undefined for empty rejection evidence', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [],
      }),
    ]);
    expect(buildPreservationRejectionFromChangePlan(plan)).toBeUndefined();
  });

  it('derives unrequested paths from preferred scope metadata', () => {
    const plan = createPlan(
      [
        createUpdateOperation('assets/app.js', {
          findings: [
            {
              code: 'PRESERVATION_ELEVATED_CHURN',
              severity: 'MEDIUM',
              message: 'Elevated churn.',
            },
          ],
          churnRatio: 0.5,
        }),
        createUpdateOperation('index.html', {
          findings: [
            {
              code: 'PRESERVATION_HIGH_CHURN_REWRITE',
              severity: 'HIGH',
              message: 'High churn.',
            },
          ],
          churnRatio: 1,
        }),
      ],
      { 'update-scope-preferred-paths': 'index.html' },
    );

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.unrequestedPaths).toEqual(['assets/app.js']);
  });

  it('builds deterministic Gate 2 correction feedback for the smoke fixture', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      rejectedPreparationId: SMOKE_031_REJECTED_PREPARATION_ID,
      operatorReason: SMOKE_031_OPERATOR_REASON,
      priorRequestSummary: 'Improve accessibility on index.html only.',
    });

    expect(feedback.preservationRejection?.rejectedPreparationId).toBe(
      SMOKE_031_REJECTED_PREPARATION_ID,
    );
    expect(feedback.preservationRejection?.operations[0]).toMatchObject({
      logicalPath: 'index.html',
      churnRatio: 1,
      removedHtmlIds: ['increment-counter', 'next-quote', 'reset-counter'],
      findingCodes: [
        'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
        'PRESERVATION_HIGH_CHURN_REWRITE',
        'PRESERVATION_REMOVED_HTML_ID',
      ],
    });
    expect(feedback.preservationRejection?.operations[0]?.crossFileReferenceRisks).toEqual([
      'increment-counter@assets/app.js',
      'next-quote@assets/app.js',
    ]);
    expect(feedback.apply.status).toBe('REJECTED');
    expect(feedback.apply.updatedPaths).toEqual(['index.html']);
  });

  it('preserves legacy feedback without preservationRejection', () => {
    const feedback = normalizeIterationFeedback({
      schemaVersion: 1,
      kind: 'CORRECTION',
      apply: {
        status: 'APPLIED',
        createdPaths: [],
        updatedPaths: ['src/a.ts'],
        deletedPaths: [],
        skippedPaths: [],
        errors: [],
        warnings: [],
      },
    });

    expect(feedback.preservationRejection).toBeUndefined();
    expect(serializedIterationFeedbackLength(feedback)).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS,
    );
  });

  it('allows up to 4,800 serialized characters when preservationRejection is present', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      rejectedPreparationId: SMOKE_031_REJECTED_PREPARATION_ID,
      operatorReason: SMOKE_031_OPERATOR_REASON,
      priorRequestSummary: 'Improve accessibility on index.html only.',
    });

    expect(serializedIterationFeedbackLength(feedback)).toBeLessThanOrEqual(
      ITERATION_FEEDBACK_LIMITS.MAX_SERIALIZED_CHARACTERS_WITH_PRESERVATION,
    );
  });

  it('does not include rejected artifact bodies in feedback', () => {
    const feedback = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, {
      operatorReason: SMOKE_031_OPERATOR_REASON,
    });
    const serialized = JSON.stringify(feedback);
    expect(serialized).not.toContain('rewritten proposal content omitted from fixture');
    expect(serialized).not.toContain('<html>');
  });

  it('produces byte-identical serialized feedback for identical inputs', () => {
    const options = {
      rejectedPreparationId: SMOKE_031_REJECTED_PREPARATION_ID,
      operatorReason: SMOKE_031_OPERATOR_REASON,
    };
    const first = buildIterationFeedbackFromGate2Rejection(SMOKE_031_REJECTED_CHANGE_PLAN, options);
    const second = buildIterationFeedbackFromGate2Rejection(
      SMOKE_031_REJECTED_CHANGE_PLAN,
      options,
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('Preservation rejection budget enforcement (ADR-031 Slice 2)', () => {
  it('bounds large removed-ID lists deterministically', () => {
    const removedHtmlIds = Array.from({ length: 20 }, (_, index) => `id-${index}`);
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_REMOVED_HTML_ID',
            severity: 'HIGH',
            message: 'Removed ids.',
          },
        ],
        removedHtmlIds,
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.removedHtmlIds).toHaveLength(8);
  });

  it('bounds large cross-file lists deterministically', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
            severity: 'HIGH',
            message: 'Cross-file risk.',
          },
        ],
        crossFileReferenceRisks: [
          { removedId: 'c-id', referencingLogicalPath: 'assets/c.js' },
          { removedId: 'a-id', referencingLogicalPath: 'assets/a.js' },
          { removedId: 'b-id', referencingLogicalPath: 'assets/b.js' },
        ],
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.crossFileReferenceRisks).toEqual([
      'a-id@assets/a.js',
      'b-id@assets/b.js',
    ]);
  });

  it('bounds large finding-code lists deterministically', () => {
    const plan = createPlan([
      createUpdateOperation('index.html', {
        findings: [
          {
            code: 'PRESERVATION_LARGE_DELETION',
            severity: 'HIGH',
            message: 'Large deletion.',
          },
          {
            code: 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
            severity: 'HIGH',
            message: 'Removed aria.',
          },
          {
            code: 'PRESERVATION_REMOVED_HTML_ID',
            severity: 'HIGH',
            message: 'Removed ids.',
          },
          {
            code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
            severity: 'HIGH',
            message: 'Cross-file risk.',
          },
          {
            code: 'PRESERVATION_HIGH_CHURN_REWRITE',
            severity: 'HIGH',
            message: 'High churn.',
          },
          {
            code: 'PRESERVATION_ELEVATED_CHURN',
            severity: 'MEDIUM',
            message: 'Elevated churn.',
          },
        ],
        churnRatio: 1,
      }),
    ]);

    const rejection = buildPreservationRejectionFromChangePlan(plan);
    expect(rejection?.operations[0]?.findingCodes).toHaveLength(4);
    expect(rejection?.operations[0]?.findingCodes).toEqual([
      'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
      'PRESERVATION_ELEVATED_CHURN',
      'PRESERVATION_HIGH_CHURN_REWRITE',
      'PRESERVATION_LARGE_DELETION',
    ]);
  });
});
