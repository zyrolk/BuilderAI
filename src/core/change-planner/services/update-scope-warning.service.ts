import type { UpdateScopePlan } from '../../update-scope';
import type { ResponseMetadata } from '../../response-processor';
import type { ProjectChangeOperation, ProjectChangeWarning } from '../types';
import { compareText } from '../validators/validation-helpers';

export const UPDATE_SCOPE_METADATA_MODE = 'update-scope-mode' as const;
export const UPDATE_SCOPE_METADATA_PREFERRED_PATHS = 'update-scope-preferred-paths' as const;
export const UPDATE_SCOPE_METADATA_PREFERRED_MAX_OPS =
  'update-scope-preferred-maximum-operations' as const;
export const UPDATE_SCOPE_PATH_SEPARATOR = '\u001f';

export class UpdateScopeWarningService {
  analyze(
    operations: readonly ProjectChangeOperation[],
    scopePlan: UpdateScopePlan | undefined,
  ): { readonly warnings: readonly ProjectChangeWarning[]; readonly metadata: ResponseMetadata } {
    if (scopePlan === undefined || scopePlan.mode === 'NONE') {
      return { warnings: [], metadata: {} };
    }

    const warnings: ProjectChangeWarning[] = [];
    const preferredPaths = new Set(scopePlan.preferredUpdatePaths);

    if (preferredPaths.size > 0) {
      const deviatedOperations = operations
        .filter(
          (operation) =>
            operation.kind === 'UPDATE_FILE' && !preferredPaths.has(operation.logicalPath),
        )
        .sort((left, right) => compareText(left.logicalPath, right.logicalPath));

      if (deviatedOperations.length > 0) {
        const deviatedPaths = [
          ...new Set(deviatedOperations.map(({ logicalPath }) => logicalPath)),
        ].sort(compareText);
        warnings.push({
          code: 'SCOPE_DEVIATION',
          message: `Generated UPDATE paths outside preferred scope: ${deviatedPaths.join(', ')}`,
          operationIds: deviatedOperations.map(({ operationId }) => operationId).sort(compareText),
        });
      }
    }

    const updateOperations = operations
      .filter((operation) => operation.kind === 'UPDATE_FILE')
      .sort((left, right) => compareText(left.logicalPath, right.logicalPath));

    if (
      scopePlan.preferredMaximumUpdateOperations !== undefined &&
      updateOperations.length > scopePlan.preferredMaximumUpdateOperations
    ) {
      warnings.push({
        code: 'PREFERRED_OPERATION_COUNT_EXCEEDED',
        message: `Preferred maximum UPDATE operations: ${scopePlan.preferredMaximumUpdateOperations}. Actual UPDATE operations: ${updateOperations.length}.`,
        operationIds: updateOperations.map(({ operationId }) => operationId).sort(compareText),
      });
    }

    return {
      warnings: warnings.sort(
        (left, right) =>
          compareText(left.code, right.code) || compareText(left.message, right.message),
      ),
      metadata: buildUpdateScopeMetadata(scopePlan),
    };
  }
}

export function buildUpdateScopeMetadata(scopePlan: UpdateScopePlan): ResponseMetadata {
  if (scopePlan.mode === 'NONE') return {};

  const metadata: Record<string, string | number | boolean> = {
    [UPDATE_SCOPE_METADATA_MODE]: scopePlan.mode,
  };

  if (scopePlan.preferredUpdatePaths.length > 0) {
    metadata[UPDATE_SCOPE_METADATA_PREFERRED_PATHS] = [...scopePlan.preferredUpdatePaths]
      .sort(compareText)
      .join(UPDATE_SCOPE_PATH_SEPARATOR);
  }

  if (scopePlan.preferredMaximumUpdateOperations !== undefined) {
    metadata[UPDATE_SCOPE_METADATA_PREFERRED_MAX_OPS] = scopePlan.preferredMaximumUpdateOperations;
  }

  return metadata as ResponseMetadata;
}

export function mergePlanMetadata(
  responseMetadata: ResponseMetadata,
  scopeMetadata: ResponseMetadata,
): ResponseMetadata {
  if (Object.keys(scopeMetadata).length === 0) {
    return structuredClone(responseMetadata);
  }

  const merged: Record<string, string | number | boolean> = {
    ...structuredClone(responseMetadata),
    ...scopeMetadata,
  };
  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => compareText(left, right)),
  ) as ResponseMetadata;
}
