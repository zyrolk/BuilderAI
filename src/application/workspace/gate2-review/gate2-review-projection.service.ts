import type { ProjectChangeOperation, ProjectChangePlan } from '../../../core/change-planner';
import type { WorkspaceBaselinePort } from '../../../core/change-planner/ports/workspace-baseline.port';
import {
  DEFAULT_WORKSPACE_PATH_PROTECTION,
  type WorkspacePathProtectionPolicy,
} from '../../../core/target-project/workspace-path-protection';
import { sha256ChecksumOfNormalizedText } from '../../../infrastructure/workspace/text-baseline-content';
import {
  DEFAULT_GATE2_REVIEW_CONFIGURATION,
  GATE2_DIFF_TRUNCATION_MESSAGE,
  GATE2_PROTECTED_DIFF_MESSAGE,
  GATE2_TEXT_DIFF_UNAVAILABLE_MESSAGE,
  GATE2_TOTAL_TRUNCATION_MESSAGE,
  type Gate2ReviewConfiguration,
} from './gate2-review-configuration';
import {
  GATE2_REVIEW_PROJECTION_SCHEMA_VERSION,
  type Gate2OperationDiff,
  type Gate2OperationLabel,
  type Gate2ReviewProjection,
} from './gate2-review.types';
import {
  countDiffLines,
  createAdditionDiff,
  createDeletionDiff,
  createUnifiedDiff,
  isTextDiffEligible,
  truncateUnifiedDiff,
} from './unified-diff';

export class Gate2ReviewProjectionService {
  constructor(
    private readonly configuration: Gate2ReviewConfiguration = DEFAULT_GATE2_REVIEW_CONFIGURATION,
    private readonly pathProtection: WorkspacePathProtectionPolicy = DEFAULT_WORKSPACE_PATH_PROTECTION,
  ) {}

  project(
    changePlan: ProjectChangePlan,
    baselinePort: WorkspaceBaselinePort,
  ): Gate2ReviewProjection {
    const operationDiffs: Gate2OperationDiff[] = [];
    let totalCharacterCount = 0;
    let totalTruncated = false;

    for (const operation of changePlan.changeSet.operations) {
      const remainingBudget = this.configuration.maximumTotalCharacters - totalCharacterCount;
      const operationDiff = this.projectOperation(operation, baselinePort, remainingBudget);
      operationDiffs.push(operationDiff);
      totalCharacterCount += operationDiff.characterCount;
      if (operationDiff.truncated) totalTruncated = true;
      if (totalCharacterCount >= this.configuration.maximumTotalCharacters) {
        totalTruncated = true;
        break;
      }
    }

    if (operationDiffs.length < changePlan.changeSet.operations.length) {
      totalTruncated = true;
    }

    return {
      schemaVersion: GATE2_REVIEW_PROJECTION_SCHEMA_VERSION,
      operationDiffs,
      totalCharacterCount,
      truncated: totalTruncated,
      ...(totalTruncated ? { truncationMessage: GATE2_TOTAL_TRUNCATION_MESSAGE } : {}),
    };
  }

  private projectOperation(
    operation: ProjectChangeOperation,
    baselinePort: WorkspaceBaselinePort,
    remainingTotalBudget: number,
  ): Gate2OperationDiff {
    if (this.pathProtection.isNeverExpose(operation.logicalPath)) {
      return {
        operationId: operation.operationId,
        kind: operation.kind,
        logicalPath: operation.logicalPath,
        label: operationLabel(operation.kind),
        format: 'PROTECTED',
        truncated: false,
        lineCount: 0,
        characterCount: GATE2_PROTECTED_DIFF_MESSAGE.length,
      };
    }

    if (operation.kind === 'CREATE_FILE') {
      return this.projectCreateOperation(operation, remainingTotalBudget);
    }
    if (operation.kind === 'DELETE_FILE') {
      return this.projectDeleteOperation(operation, baselinePort, remainingTotalBudget);
    }
    return this.projectUpdateOperation(operation, baselinePort, remainingTotalBudget);
  }

  private projectCreateOperation(
    operation: Extract<ProjectChangeOperation, { kind: 'CREATE_FILE' }>,
    remainingTotalBudget: number,
  ): Gate2OperationDiff {
    if (!isTextDiffEligible(operation.content)) {
      return unavailableOperationDiff(operation, 'CREATE_FILE');
    }
    const proposedChecksum = sha256ChecksumOfNormalizedText(operation.content);
    const perOperationBudget = Math.min(
      this.configuration.maximumCharactersPerOperation,
      remainingTotalBudget,
    );
    const rawDiff = createAdditionDiff(operation.logicalPath, operation.content);
    const { diff, truncated } = truncateUnifiedDiff(
      rawDiff,
      this.configuration.maximumLinesPerOperation,
      perOperationBudget,
    );
    return {
      operationId: operation.operationId,
      kind: operation.kind,
      logicalPath: operation.logicalPath,
      label: 'NEW FILE',
      format: 'UNIFIED',
      unifiedDiff: diff,
      truncated,
      ...(truncated ? { truncationMessage: GATE2_DIFF_TRUNCATION_MESSAGE } : {}),
      proposedContentChecksum: proposedChecksum,
      lineCount: countDiffLines(diff),
      characterCount: diff.length,
    };
  }

  private projectDeleteOperation(
    operation: Extract<ProjectChangeOperation, { kind: 'DELETE_FILE' }>,
    baselinePort: WorkspaceBaselinePort,
    remainingTotalBudget: number,
  ): Gate2OperationDiff {
    const baseline = baselinePort.readTextBaseline(operation.logicalPath);
    if (baseline === null || !isTextDiffEligible(baseline.content)) {
      return unavailableOperationDiff(operation, 'DELETE_FILE');
    }
    const perOperationBudget = Math.min(
      this.configuration.maximumCharactersPerOperation,
      remainingTotalBudget,
    );
    const rawDiff = createDeletionDiff(operation.logicalPath, baseline.content);
    const { diff, truncated } = truncateUnifiedDiff(
      rawDiff,
      this.configuration.maximumLinesPerOperation,
      perOperationBudget,
    );
    return {
      operationId: operation.operationId,
      kind: operation.kind,
      logicalPath: operation.logicalPath,
      label: 'DELETE FILE',
      format: 'UNIFIED',
      unifiedDiff: diff,
      truncated,
      ...(truncated ? { truncationMessage: GATE2_DIFF_TRUNCATION_MESSAGE } : {}),
      baselineContentChecksum: baseline.checksum,
      lineCount: countDiffLines(diff),
      characterCount: diff.length,
    };
  }

  private projectUpdateOperation(
    operation: Extract<ProjectChangeOperation, { kind: 'UPDATE_FILE' }>,
    baselinePort: WorkspaceBaselinePort,
    remainingTotalBudget: number,
  ): Gate2OperationDiff {
    if (!isTextDiffEligible(operation.content)) {
      return unavailableOperationDiff(operation, 'UPDATE_FILE');
    }
    const baseline = baselinePort.readTextBaseline(operation.logicalPath);
    if (baseline === null || !isTextDiffEligible(baseline.content)) {
      return unavailableOperationDiff(operation, 'UPDATE_FILE');
    }
    const proposedChecksum = sha256ChecksumOfNormalizedText(operation.content);
    const perOperationBudget = Math.min(
      this.configuration.maximumCharactersPerOperation,
      remainingTotalBudget,
    );
    const rawDiff = createUnifiedDiff({
      logicalPath: operation.logicalPath,
      baselineContent: baseline.content,
      proposedContent: operation.content,
      contextLines: this.configuration.contextLines,
    });
    const { diff, truncated } = truncateUnifiedDiff(
      rawDiff,
      this.configuration.maximumLinesPerOperation,
      perOperationBudget,
    );
    return {
      operationId: operation.operationId,
      kind: operation.kind,
      logicalPath: operation.logicalPath,
      label: 'UPDATE FILE',
      format: 'UNIFIED',
      unifiedDiff: diff,
      truncated,
      ...(truncated ? { truncationMessage: GATE2_DIFF_TRUNCATION_MESSAGE } : {}),
      baselineContentChecksum:
        operation.baselineContentChecksum ??
        operation.preservation?.baselineContentChecksum ??
        baseline.checksum,
      proposedContentChecksum: proposedChecksum,
      lineCount: countDiffLines(diff),
      characterCount: diff.length,
    };
  }
}

function operationLabel(kind: ProjectChangeOperation['kind']): Gate2OperationLabel {
  if (kind === 'CREATE_FILE') return 'NEW FILE';
  if (kind === 'DELETE_FILE') return 'DELETE FILE';
  return 'UPDATE FILE';
}

function unavailableOperationDiff(
  operation: ProjectChangeOperation,
  kind: ProjectChangeOperation['kind'],
): Gate2OperationDiff {
  return {
    operationId: operation.operationId,
    kind,
    logicalPath: operation.logicalPath,
    label: operationLabel(kind),
    format: 'UNAVAILABLE',
    truncated: false,
    lineCount: 0,
    characterCount: GATE2_TEXT_DIFF_UNAVAILABLE_MESSAGE.length,
  };
}
