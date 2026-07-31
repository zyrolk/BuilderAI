import type {
  ProjectChangeOperation,
  ProjectChangePlanSummary,
  ProjectChangeWarning,
} from '../types';
import { compareText } from '../validators/validation-helpers';

export class ChangePlanSummaryService {
  generate(
    operations: readonly ProjectChangeOperation[],
    warnings: readonly ProjectChangeWarning[],
  ): ProjectChangePlanSummary {
    const pathsFor = (kind: ProjectChangeOperation['kind']): readonly string[] =>
      operations
        .filter((operation) => operation.kind === kind)
        .map(({ logicalPath }) => logicalPath)
        .sort(compareText);
    return {
      filesCreated: pathsFor('CREATE_FILE'),
      filesUpdated: pathsFor('UPDATE_FILE'),
      filesDeleted: pathsFor('DELETE_FILE'),
      totalOperations: operations.length,
      warnings: [...new Set(warnings.map(({ code }) => code))].sort(compareText),
    };
  }
}
