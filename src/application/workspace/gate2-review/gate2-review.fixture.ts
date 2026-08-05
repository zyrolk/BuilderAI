import {
  createOperationId,
  type ProjectChangeOperation,
  type ProjectChangePlan,
} from '../../../core/change-planner';
import { MemoryWorkspaceBaselinePort } from '../../../core/update-scope/test/workspace-baseline.fixture';
import { Gate2ReviewProjectionService, type Gate2ReviewProjection } from '../gate2-review';

export const EMPTY_GATE2_REVIEW: Gate2ReviewProjection = {
  schemaVersion: 1,
  operationDiffs: [],
  totalCharacterCount: 0,
  truncated: false,
};

export function projectGate2ReviewForPlan(
  changePlan: ProjectChangePlan,
  baselineFiles: Record<string, string> = {},
): Gate2ReviewProjection {
  return new Gate2ReviewProjectionService().project(
    changePlan,
    new MemoryWorkspaceBaselinePort(baselineFiles),
  );
}

export function createUpdateOperation(
  logicalPath: string,
  baselineContent: string,
  proposedContent: string,
  description = 'Update file',
): ProjectChangeOperation {
  return {
    operationId: createOperationId('UPDATE_FILE', logicalPath),
    kind: 'UPDATE_FILE',
    logicalPath,
    artifactType: 'SOURCE_FILE',
    description,
    sourceChecksum: { algorithm: 'sha256', value: 'b'.repeat(64) },
    sourceSizeBytes: proposedContent.length,
    content: proposedContent,
    baselineContentChecksum: {
      algorithm: 'sha256',
      value: 'a'.repeat(64),
    },
  };
}

export function createCreateOperation(
  logicalPath: string,
  content: string,
  description = 'Create file',
): ProjectChangeOperation {
  return {
    operationId: createOperationId('CREATE_FILE', logicalPath),
    kind: 'CREATE_FILE',
    logicalPath,
    artifactType: 'SOURCE_FILE',
    description,
    sourceChecksum: { algorithm: 'sha256', value: 'c'.repeat(64) },
    sourceSizeBytes: content.length,
    content,
  };
}

export function createDeleteOperation(
  logicalPath: string,
  description = 'Delete file',
): ProjectChangeOperation {
  return {
    operationId: createOperationId('DELETE_FILE', logicalPath),
    kind: 'DELETE_FILE',
    logicalPath,
    artifactType: 'SOURCE_FILE',
    description,
    sourceChecksum: { algorithm: 'sha256', value: 'd'.repeat(64) },
    sourceSizeBytes: 0,
  };
}

export function createPlanFromOperations(
  operations: readonly ProjectChangeOperation[],
): ProjectChangePlan {
  return {
    schemaVersion: 1,
    source: { responsePackageSchemaVersion: 1, executionId: 'execution-gate2-test' },
    changeSet: { operations },
    summary: {
      filesCreated: operations
        .filter(({ kind }) => kind === 'CREATE_FILE')
        .map(({ logicalPath }) => logicalPath),
      filesUpdated: operations
        .filter(({ kind }) => kind === 'UPDATE_FILE')
        .map(({ logicalPath }) => logicalPath),
      filesDeleted: operations
        .filter(({ kind }) => kind === 'DELETE_FILE')
        .map(({ logicalPath }) => logicalPath),
      totalOperations: operations.length,
      warnings: [],
    },
    risks: [],
    warnings: [],
    metadata: {},
  };
}
