import { createOperationId, type ProjectChangePlan } from '../../../core/change-planner';

export const SMOKE_031_REJECTED_PREPARATION_ID = '3cfc8ddc-27a9-431e-bdb4-6639aa503381';

export const SMOKE_031_OPERATOR_REASON =
  'Proposal rewrote unrelated HTML structure and would break unchanged JS hooks. Preserve existing DOM IDs and structure; apply only requested accessibility attributes.';

export const SMOKE_031_REJECTED_CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: {
    responsePackageSchemaVersion: 1,
    executionId: 'execution-smoke-031-rejected',
  },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('UPDATE_FILE', 'index.html'),
        kind: 'UPDATE_FILE',
        logicalPath: 'index.html',
        artifactType: 'SOURCE_FILE',
        description: 'Update index.html accessibility attributes.',
        sourceChecksum: { algorithm: 'sha256', value: 'b'.repeat(64) },
        sourceSizeBytes: 2_048,
        content: '<html>rewritten proposal content omitted from fixture</html>',
        baselineContentChecksum: {
          algorithm: 'sha256',
          value: 'E2B856A12B082C742131C552F54EAAFDE8F1BA340E4415FC962A5EA279E3B8BB',
        },
        preservation: {
          baselineBytes: 1_920,
          proposedBytes: 2_048,
          baselineLines: 72,
          proposedLines: 88,
          linesAdded: 72,
          linesDeleted: 72,
          linesUnchanged: 0,
          churnRatio: 1,
          similarityRatio: 0,
          removedHtmlIds: ['increment-counter', 'reset-counter', 'next-quote'],
          removedAccessibilityAttributes: ['aria-live'],
          crossFileReferenceRisks: [
            { removedId: 'increment-counter', referencingLogicalPath: 'assets/app.js' },
            { removedId: 'reset-counter', referencingLogicalPath: 'assets/app.js' },
            { removedId: 'next-quote', referencingLogicalPath: 'assets/app.js' },
          ],
          findings: [
            {
              code: 'PRESERVATION_HIGH_CHURN_REWRITE',
              severity: 'HIGH',
              message: 'Update churn ratio 1.0000 exceeds the high threshold (0.7).',
            },
            {
              code: 'PRESERVATION_REMOVED_HTML_ID',
              severity: 'HIGH',
              message: 'Removed stable HTML ids: increment-counter, reset-counter, next-quote.',
            },
            {
              code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
              severity: 'HIGH',
              message: 'Removed HTML ids are referenced by unchanged sibling files: assets/app.js.',
            },
          ],
        },
      },
    ],
  },
  summary: {
    filesCreated: [],
    filesUpdated: ['index.html'],
    filesDeleted: [],
    totalOperations: 1,
    warnings: [],
  },
  risks: [],
  warnings: [],
  metadata: {
    'update-scope-mode': 'HARD',
    'update-scope-preferred-paths': 'index.html',
  },
};
