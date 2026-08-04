import { createOperationId, type ProjectChangePlan } from '../../../core/change-planner';

/** Slice 3 correction fixture: elevated churn (0.4444), IDs preserved, no cross-file risks. */
export const SMOKE_031_MARGINAL_CHURN_CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: {
    responsePackageSchemaVersion: 1,
    executionId: 'execution-smoke-031-marginal-churn',
  },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('UPDATE_FILE', 'index.html'),
        kind: 'UPDATE_FILE',
        logicalPath: 'index.html',
        artifactType: 'SOURCE_FILE',
        description: 'Update index.html accessibility attributes.',
        sourceChecksum: { algorithm: 'sha256', value: '4'.repeat(64) },
        sourceSizeBytes: 1_280,
        content: '<html>marginal churn proposal omitted from fixture</html>',
        baselineContentChecksum: {
          algorithm: 'sha256',
          value: 'E2B856A12B082C742131C552F54EAAFDE8F1BA340E4415FC962A5EA279E3B8BB',
        },
        preservation: {
          baselineBytes: 1_113,
          proposedBytes: 1_280,
          baselineLines: 36,
          proposedLines: 36,
          linesAdded: 8,
          linesDeleted: 8,
          linesUnchanged: 28,
          churnRatio: 0.4444,
          similarityRatio: 0.7778,
          structuredAnalysis: {
            kind: 'HTML',
            parseStatus: 'SUCCESS',
            attributeChanges: 8,
            textChanges: 0,
            structuralChanges: 0,
            formattingOnlyEvidence: false,
            preservedStableIdCount: 6,
            removedStableIdCount: 0,
            elementCountBaseline: 25,
            elementCountProposed: 25,
          },
          surgicality: {
            classification: 'EXCELLENT',
            basis: 'STRUCTURED_HTML',
            reasons: ['Structured HTML: 8 attribute-only change(s)'],
          },
          findings: [
            {
              code: 'PRESERVATION_ELEVATED_CHURN',
              severity: 'MEDIUM',
              message: 'Update churn ratio 0.4444 is elevated (0.4–0.7).',
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
    'update-scope-preferred-maximum-operations': 1,
  },
};

export const SMOKE_031_SLICE4_OPERATOR_REASON =
  'Preserve all existing DOM IDs, text, structure, aria-labels, formatting, whitespace, script/style references, and behavior. Apply only the requested accessibility attributes. Keep unchanged baseline lines verbatim and minimize textual churn. Do not redesign, refactor, rename, reorder, or reformat unrelated HTML.';
