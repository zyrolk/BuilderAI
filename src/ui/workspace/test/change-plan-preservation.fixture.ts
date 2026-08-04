import { createOperationId, type ProjectChangePlan } from '../../../core/change-planner';

const BASELINE_CHECKSUM = {
  algorithm: 'sha256',
  value: '1111111111111111111111111111111111111111111111111111111111111111',
} as const;

const PROPOSED_CHECKSUM = {
  algorithm: 'sha256',
  value: '2222222222222222222222222222222222222222222222222222222222222222',
} as const;

const SURGICAL_BASELINE_CHECKSUM = {
  algorithm: 'sha256',
  value: '3333333333333333333333333333333333333333333333333333333333333333',
} as const;

const SURGICAL_PROPOSED_CHECKSUM = {
  algorithm: 'sha256',
  value: '4444444444444444444444444444444444444444444444444444444444444444',
} as const;

export const LEGACY_UPDATE_CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: { responsePackageSchemaVersion: 1, executionId: 'execution-legacy-update' },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('UPDATE_FILE', 'src/legacy.ts'),
        kind: 'UPDATE_FILE',
        logicalPath: 'src/legacy.ts',
        artifactType: 'SOURCE_FILE',
        description: 'Legacy update without preservation metadata',
        sourceChecksum: PROPOSED_CHECKSUM,
        sourceSizeBytes: 12,
        content: 'legacy content\n',
      },
    ],
  },
  summary: {
    filesCreated: [],
    filesUpdated: ['src/legacy.ts'],
    filesDeleted: [],
    totalOperations: 1,
    warnings: [],
  },
  risks: [],
  warnings: [],
  metadata: {},
};

export const BASELINE_UNAVAILABLE_CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: { responsePackageSchemaVersion: 1, executionId: 'execution-baseline-unavailable' },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('UPDATE_FILE', 'index.html'),
        kind: 'UPDATE_FILE',
        logicalPath: 'index.html',
        artifactType: 'SOURCE_FILE',
        description: 'Update without readable baseline',
        sourceChecksum: PROPOSED_CHECKSUM,
        sourceSizeBytes: 20,
        content: '<div>updated</div>\n',
      },
    ],
  },
  summary: {
    filesCreated: [],
    filesUpdated: ['index.html'],
    filesDeleted: [],
    totalOperations: 1,
    warnings: ['PRESERVATION_BASELINE_UNAVAILABLE'],
  },
  risks: [],
  warnings: [
    {
      code: 'PRESERVATION_BASELINE_UNAVAILABLE',
      message:
        "Baseline content for 'index.html' is unavailable; preservation analysis was skipped.",
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
  ],
  metadata: {},
};

export const DESTRUCTIVE_PRESERVATION_CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: { responsePackageSchemaVersion: 1, executionId: 'execution-destructive-html' },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('UPDATE_FILE', 'index.html'),
        kind: 'UPDATE_FILE',
        logicalPath: 'index.html',
        artifactType: 'SOURCE_FILE',
        description: 'Destructive HTML rewrite',
        sourceChecksum: PROPOSED_CHECKSUM,
        sourceSizeBytes: 320,
        content: '<div id="container">rewrite</div>\n',
        baselineContentChecksum: BASELINE_CHECKSUM,
        preservation: {
          baselineContentChecksum: BASELINE_CHECKSUM,
          baselineBytes: 480,
          proposedBytes: 320,
          baselineLines: 18,
          proposedLines: 12,
          linesAdded: 10,
          linesDeleted: 16,
          linesUnchanged: 2,
          churnRatio: 0.8889,
          similarityRatio: 0.1111,
          removedHtmlIds: ['app-root', 'counter-heading', 'counter-value', 'increment-counter'],
          addedHtmlIds: ['container', 'count-display', 'increment-btn'],
          removedAccessibilityAttributes: ['aria-label', 'aria-live', 'aria-labelledby'],
          crossFileReferenceRisks: [
            { removedId: 'counter-value', referencingLogicalPath: 'assets/app.js' },
            { removedId: 'increment-counter', referencingLogicalPath: 'assets/app.js' },
          ],
          findings: [
            {
              code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
              severity: 'CRITICAL',
              message:
                'Removed HTML ids are still referenced by unchanged sibling files: counter-value in assets/app.js; increment-counter in assets/app.js.',
            },
            {
              code: 'PRESERVATION_HIGH_CHURN_REWRITE',
              severity: 'HIGH',
              message: 'Update churn ratio 0.8889 exceeds the high threshold (0.7).',
            },
            {
              code: 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
              severity: 'MEDIUM',
              message: 'Removed accessibility attributes: aria-label, aria-live, aria-labelledby.',
            },
            {
              code: 'PRESERVATION_REMOVED_HTML_ID',
              severity: 'MEDIUM',
              message:
                'Removed HTML ids: app-root, counter-heading, counter-value, increment-counter.',
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
    warnings: [
      'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
      'PRESERVATION_HIGH_CHURN_REWRITE',
      'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
      'PRESERVATION_REMOVED_HTML_ID',
    ],
  },
  risks: [
    {
      code: 'HIGH_CHURN_REWRITE',
      severity: 'MEDIUM',
      message: 'An update operation proposes a high-churn rewrite that requires explicit review.',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
    {
      code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
      severity: 'HIGH',
      message:
        'An HTML update removes identifiers still referenced by unchanged sibling JavaScript files.',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
  ],
  warnings: [
    {
      code: 'PRESERVATION_CROSS_FILE_REFERENCE_RISK',
      message:
        'Removed HTML ids are still referenced by unchanged sibling files: counter-value in assets/app.js; increment-counter in assets/app.js.',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
    {
      code: 'PRESERVATION_HIGH_CHURN_REWRITE',
      message: 'Update churn ratio 0.8889 exceeds the high threshold (0.7).',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
    {
      code: 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
      message: 'Removed accessibility attributes: aria-label, aria-live, aria-labelledby.',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
    {
      code: 'PRESERVATION_REMOVED_HTML_ID',
      message: 'Removed HTML ids: app-root, counter-heading, counter-value, increment-counter.',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
  ],
  metadata: {},
};

export const SURGICAL_PRESERVATION_CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: { responsePackageSchemaVersion: 1, executionId: 'execution-surgical-html' },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('UPDATE_FILE', 'index.html'),
        kind: 'UPDATE_FILE',
        logicalPath: 'index.html',
        artifactType: 'SOURCE_FILE',
        description: 'Add aria-describedby without rewrite',
        sourceChecksum: SURGICAL_PROPOSED_CHECKSUM,
        sourceSizeBytes: 520,
        content: '<button aria-describedby="counter-help"></button>\n',
        baselineContentChecksum: SURGICAL_BASELINE_CHECKSUM,
        preservation: {
          baselineContentChecksum: SURGICAL_BASELINE_CHECKSUM,
          baselineBytes: 500,
          proposedBytes: 520,
          baselineLines: 18,
          proposedLines: 19,
          linesAdded: 1,
          linesDeleted: 0,
          linesUnchanged: 18,
          churnRatio: 0.0556,
          similarityRatio: 0.9474,
          removedHtmlIds: [],
          addedHtmlIds: ['counter-help'],
          removedAccessibilityAttributes: [],
          crossFileReferenceRisks: [],
          findings: [],
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
  metadata: {},
};

export const MIXED_OPERATIONS_CHANGE_PLAN: ProjectChangePlan = {
  schemaVersion: 1,
  source: { responsePackageSchemaVersion: 1, executionId: 'execution-mixed' },
  changeSet: {
    operations: [
      {
        operationId: createOperationId('CREATE_FILE', 'src/new.ts'),
        kind: 'CREATE_FILE',
        logicalPath: 'src/new.ts',
        artifactType: 'SOURCE_FILE',
        description: 'Create a new file',
        sourceChecksum: PROPOSED_CHECKSUM,
        sourceSizeBytes: 10,
        content: 'export {}\n',
      },
      {
        operationId: createOperationId('UPDATE_FILE', 'index.html'),
        kind: 'UPDATE_FILE',
        logicalPath: 'index.html',
        artifactType: 'SOURCE_FILE',
        description: 'Moderate HTML update',
        sourceChecksum: PROPOSED_CHECKSUM,
        sourceSizeBytes: 320,
        content: '<div>updated</div>\n',
        baselineContentChecksum: BASELINE_CHECKSUM,
        preservation: {
          baselineContentChecksum: BASELINE_CHECKSUM,
          baselineBytes: 480,
          proposedBytes: 320,
          baselineLines: 20,
          proposedLines: 18,
          linesAdded: 4,
          linesDeleted: 6,
          linesUnchanged: 14,
          churnRatio: 0.5,
          similarityRatio: 0.7,
          removedHtmlIds: ['legacy-id'],
          addedHtmlIds: [],
          removedAccessibilityAttributes: ['aria-live'],
          crossFileReferenceRisks: [],
          findings: [
            {
              code: 'PRESERVATION_ELEVATED_CHURN',
              severity: 'MEDIUM',
              message: 'Update churn ratio 0.5000 is elevated (0.4–0.7).',
            },
            {
              code: 'PRESERVATION_LARGE_DELETION',
              severity: 'MEDIUM',
              message:
                'Large deletion detected (0.3000 of baseline lines removed with limited replacement).',
            },
            {
              code: 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
              severity: 'MEDIUM',
              message: 'Removed accessibility attributes: aria-live.',
            },
            {
              code: 'PRESERVATION_REMOVED_HTML_ID',
              severity: 'MEDIUM',
              message: 'Removed HTML ids: legacy-id.',
            },
          ],
        },
      },
      {
        operationId: createOperationId('DELETE_FILE', 'old/file.ts'),
        kind: 'DELETE_FILE',
        logicalPath: 'old/file.ts',
        artifactType: 'SOURCE_FILE',
        description: 'Delete obsolete file',
        sourceChecksum: PROPOSED_CHECKSUM,
        sourceSizeBytes: 0,
      },
    ],
  },
  summary: {
    filesCreated: ['src/new.ts'],
    filesUpdated: ['index.html'],
    filesDeleted: ['old/file.ts'],
    totalOperations: 3,
    warnings: [
      'PRESERVATION_ELEVATED_CHURN',
      'PRESERVATION_LARGE_DELETION',
      'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
      'PRESERVATION_REMOVED_HTML_ID',
    ],
  },
  risks: [],
  warnings: [
    {
      code: 'PRESERVATION_ELEVATED_CHURN',
      message: 'Update churn ratio 0.5000 is elevated (0.4–0.7).',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
    {
      code: 'PRESERVATION_LARGE_DELETION',
      message:
        'Large deletion detected (0.3000 of baseline lines removed with limited replacement).',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
    {
      code: 'PRESERVATION_REMOVED_ARIA_ATTRIBUTE',
      message: 'Removed accessibility attributes: aria-live.',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
    {
      code: 'PRESERVATION_REMOVED_HTML_ID',
      message: 'Removed HTML ids: legacy-id.',
      operationIds: [createOperationId('UPDATE_FILE', 'index.html')],
    },
  ],
  metadata: {},
};
