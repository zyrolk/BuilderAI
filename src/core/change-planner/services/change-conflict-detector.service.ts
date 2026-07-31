import {
  ChangePlanValidationError,
  type ChangePlanValidationIssue,
  type ProjectChangeOperation,
} from '../types';

export class ChangeConflictDetectorService {
  validate(operations: readonly ProjectChangeOperation[]): void {
    const issues: ChangePlanValidationIssue[] = [];
    const operationIds = new Map<string, number>();
    const paths = new Map<string, { readonly index: number; readonly kind: string }>();

    operations.forEach((operation, index) => {
      const existingId = operationIds.get(operation.operationId);
      if (existingId !== undefined) {
        issues.push({
          code: 'DUPLICATE_OPERATION',
          path: `$.changeSet.operations[${index}].operationId`,
          message: `duplicates operation at index ${existingId}`,
        });
      } else {
        operationIds.set(operation.operationId, index);
      }
      const comparablePath = operation.logicalPath.toLowerCase();
      const existingPath = paths.get(comparablePath);
      if (existingPath !== undefined) {
        issues.push({
          code:
            existingPath.kind === operation.kind ? 'DUPLICATE_OPERATION' : 'CONFLICTING_OPERATIONS',
          path: `$.changeSet.operations[${index}].logicalPath`,
          message: `conflicts with operation at index ${existingPath.index}`,
        });
      } else {
        paths.set(comparablePath, { index, kind: operation.kind });
      }
    });

    const pathEntries = [...paths.entries()];
    for (let leftIndex = 0; leftIndex < pathEntries.length; leftIndex += 1) {
      const left = pathEntries[leftIndex];
      if (left === undefined) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < pathEntries.length; rightIndex += 1) {
        const right = pathEntries[rightIndex];
        if (right === undefined) continue;
        if (left[0].startsWith(`${right[0]}/`) || right[0].startsWith(`${left[0]}/`)) {
          issues.push({
            code: 'CONFLICTING_OPERATIONS',
            path: `$.changeSet.operations[${right[1].index}].logicalPath`,
            message: `has a file/tree conflict with operation at index ${left[1].index}`,
          });
        }
      }
    }
    if (issues.length > 0) throw new ChangePlanValidationError(issues);
  }
}
