import type { ChangeOperationKind, ProjectChangeOperation } from '../types';
import { compareText } from '../validators/validation-helpers';

const KIND_ORDER: Readonly<Record<ChangeOperationKind, number>> = {
  CREATE_FILE: 0,
  UPDATE_FILE: 1,
  DELETE_FILE: 2,
};

export function createOperationId(kind: ChangeOperationKind, logicalPath: string): string {
  return `${kind.toLowerCase().replace('_', '-')}:${logicalPath.toLowerCase()}`;
}

export class OperationOrderingService {
  order(operations: readonly ProjectChangeOperation[]): readonly ProjectChangeOperation[] {
    return operations
      .map((operation) => structuredClone(operation))
      .sort(
        (left, right) =>
          KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
          compareText(left.logicalPath.toLowerCase(), right.logicalPath.toLowerCase()) ||
          compareText(left.logicalPath, right.logicalPath),
      );
  }
}
