import { describe, expect, it } from 'vitest';

import { UPDATE_SCOPE_PLAN_SCHEMA_VERSION } from '../../update-scope';
import {
  buildUpdateScopeMetadata,
  mergePlanMetadata,
  UpdateScopeWarningService,
} from '../services/update-scope-warning.service';
import { createOperationId } from '../services/operation-ordering.service';

describe('UpdateScopeWarningService unit tests (ADR-031 Slice 3)', () => {
  const service = new UpdateScopeWarningService();

  it('builds SOFT scope metadata without preferred maximum operations', () => {
    const metadata = buildUpdateScopeMetadata({
      schemaVersion: UPDATE_SCOPE_PLAN_SCHEMA_VERSION,
      mode: 'SOFT',
      requiredBaselinePaths: ['index.html'],
      preferredUpdatePaths: ['index.html', 'assets/app.js'],
      evidence: [],
    });

    expect(metadata['update-scope-mode']).toBe('SOFT');
    expect(metadata['update-scope-preferred-paths']).toBe('assets/app.js\u001findex.html');
    expect(metadata['update-scope-preferred-maximum-operations']).toBeUndefined();
  });

  it('returns empty metadata for NONE scope mode', () => {
    expect(
      buildUpdateScopeMetadata({
        schemaVersion: UPDATE_SCOPE_PLAN_SCHEMA_VERSION,
        mode: 'NONE',
        requiredBaselinePaths: [],
        preferredUpdatePaths: [],
        evidence: [],
      }),
    ).toEqual({});
  });

  it('merges plan metadata without mutating response metadata when scope metadata is empty', () => {
    const responseMetadata = { 'correlation-id': 'abc', source: 'workspace' };
    expect(mergePlanMetadata(responseMetadata, {})).toEqual(responseMetadata);
  });

  it('merges scope metadata in canonical sorted key order', () => {
    const merged = mergePlanMetadata(
      { source: 'workspace', 'correlation-id': 'abc' },
      {
        'update-scope-mode': 'HARD',
        'update-scope-preferred-paths': 'index.html',
        'update-scope-preferred-maximum-operations': 1,
      },
    );

    expect(Object.keys(merged)).toEqual([
      'correlation-id',
      'source',
      'update-scope-mode',
      'update-scope-preferred-maximum-operations',
      'update-scope-preferred-paths',
    ]);
  });

  it('does not emit count warning when UPDATE count equals preferred maximum', () => {
    const result = service.analyze(
      [
        {
          operationId: createOperationId('UPDATE_FILE', 'index.html'),
          kind: 'UPDATE_FILE',
          logicalPath: 'index.html',
          artifactType: 'SOURCE_FILE',
          description: 'Update index.html',
          sourceChecksum: { algorithm: 'sha256', value: 'a'.repeat(64) },
          sourceSizeBytes: 10,
          content: '<html></html>',
        },
      ],
      {
        schemaVersion: UPDATE_SCOPE_PLAN_SCHEMA_VERSION,
        mode: 'HARD',
        requiredBaselinePaths: ['index.html'],
        preferredUpdatePaths: ['index.html'],
        preferredMaximumUpdateOperations: 1,
        evidence: [],
      },
    );

    expect(result.warnings.some(({ code }) => code === 'PREFERRED_OPERATION_COUNT_EXCEEDED')).toBe(
      false,
    );
  });
});
