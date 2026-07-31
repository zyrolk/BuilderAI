import type { ProjectChangeOperation, ProjectChangeRisk, ProjectChangeWarning } from '../types';
import type { ChangePlannerConfiguration } from '../config';
import { compareText } from '../validators/validation-helpers';

export class ChangeRiskService {
  constructor(private readonly configuration: ChangePlannerConfiguration) {}

  evaluate(operations: readonly ProjectChangeOperation[]): readonly ProjectChangeRisk[] {
    const risks: ProjectChangeRisk[] = [];
    const deleted = operations.filter(({ kind }) => kind === 'DELETE_FILE');
    if (deleted.length > 0) {
      risks.push({
        code: 'DESTRUCTIVE_CHANGE',
        severity: 'HIGH',
        message: 'The plan contains file deletion intents that require explicit review.',
        operationIds: deleted.map(({ operationId }) => operationId).sort(compareText),
      });
    }
    const configuration = operations.filter(({ artifactType }) => artifactType === 'CONFIGURATION');
    if (configuration.length > 0) {
      risks.push({
        code: 'CONFIGURATION_CHANGE',
        severity: 'MEDIUM',
        message: 'Configuration changes may affect build, runtime, or security behavior.',
        operationIds: configuration.map(({ operationId }) => operationId).sort(compareText),
      });
    }
    if (operations.length >= this.configuration.broadChangeOperationThreshold) {
      risks.push({
        code: 'BROAD_CHANGE_SET',
        severity: 'MEDIUM',
        message: 'The number of planned operations requires segmented review.',
        operationIds: operations.map(({ operationId }) => operationId).sort(compareText),
      });
    }
    return risks.sort((left, right) => compareText(left.code, right.code));
  }

  createWarnings(
    operations: readonly ProjectChangeOperation[],
    responseWarnings: readonly { readonly code: string; readonly message: string }[],
  ): readonly ProjectChangeWarning[] {
    const warnings: ProjectChangeWarning[] = [
      {
        code: 'UNVERIFIED_PROJECT_STATE',
        message:
          'The planner does not read project state, so create, update, and delete preconditions are not verified.',
        operationIds: operations.map(({ operationId }) => operationId).sort(compareText),
      },
      ...responseWarnings.map(({ code, message }) => ({
        code: `RESPONSE_${code}`,
        message,
        operationIds: [] as readonly string[],
      })),
    ];
    return warnings.sort(
      (left, right) =>
        compareText(left.code, right.code) || compareText(left.message, right.message),
    );
  }
}
