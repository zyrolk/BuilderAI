import { isSafeLogicalPath, RESPONSE_PACKAGE_SCHEMA_VERSION } from '../../response-processor';
import type { ChangePlannerConfiguration } from '../config';
import { DEFAULT_CHANGE_PLANNER_CONFIGURATION } from '../config';
import { ChangeConflictDetectorService } from '../services/change-conflict-detector.service';
import { ChangePlanSummaryService } from '../services/change-plan-summary.service';
import {
  createOperationId,
  OperationOrderingService,
} from '../services/operation-ordering.service';
import {
  CHANGE_OPERATION_KINDS,
  CHANGE_RISK_SEVERITIES,
  ChangePlanValidationError,
  PROJECT_CHANGE_PLAN_SCHEMA_VERSION,
  type ChangePlanValidationIssue,
  type ChangeOperationKind,
  type ChangeRiskSeverity,
  type ProjectChangePlan,
} from '../types';
import { ChangePlannerConfigurationValidator } from './configuration.validator';
import {
  addIssue,
  CHECKSUM_IDENTIFIER_PATTERN,
  CHECKSUM_VALUE_PATTERN,
  isNonNegativeSafeInteger,
  isRecord,
  isSorted,
  utf8Size,
  validateExactKeys,
  validateMetadata,
} from './validation-helpers';

export class ProjectChangePlanValidator {
  private readonly configurationValidator: ChangePlannerConfigurationValidator =
    new ChangePlannerConfigurationValidator();
  private readonly conflictDetector = new ChangeConflictDetectorService();
  private readonly ordering = new OperationOrderingService();
  private readonly summary = new ChangePlanSummaryService();

  constructor(
    private readonly configuration: ChangePlannerConfiguration = DEFAULT_CHANGE_PLANNER_CONFIGURATION,
  ) {
    this.configurationValidator.validate(configuration);
  }

  validate(value: unknown): asserts value is ProjectChangePlan {
    const issues: ChangePlanValidationIssue[] = [];
    if (!isRecord(value)) {
      throw new ChangePlanValidationError([
        { code: 'INVALID_CHANGE_PLAN', path: '$', message: 'must be an object' },
      ]);
    }
    validateExactKeys(
      value,
      ['schemaVersion', 'source', 'changeSet', 'summary', 'risks', 'warnings', 'metadata'],
      '$',
      issues,
    );
    if (value.schemaVersion !== PROJECT_CHANGE_PLAN_SCHEMA_VERSION) {
      addIssue(
        issues,
        'UNSUPPORTED_PLAN_VERSION',
        '$.schemaVersion',
        `must equal ${PROJECT_CHANGE_PLAN_SCHEMA_VERSION}`,
      );
    }
    this.validateSource(value.source, issues);
    this.validateChangeSet(value.changeSet, issues);
    this.validateSummary(value.summary, issues);
    this.validateRisks(value.risks, issues);
    this.validateWarnings(value.warnings, issues);
    validateMetadata(
      value.metadata,
      '$.metadata',
      issues,
      this.configuration.maximumMetadataEntries,
      this.configuration.maximumMetadataStringCharacters,
    );
    if (issues.length === 0 && isProjectChangePlanShape(value)) {
      this.validateRelationships(value, issues);
    }
    if (issues.length > 0) throw new ChangePlanValidationError(issues);
  }

  private validateSource(value: unknown, issues: ChangePlanValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.source', 'must be an object');
      return;
    }
    validateExactKeys(value, ['responsePackageSchemaVersion', 'executionId'], '$.source', issues);
    if (value.responsePackageSchemaVersion !== RESPONSE_PACKAGE_SCHEMA_VERSION) {
      addIssue(
        issues,
        'INVALID_REFERENCE',
        '$.source.responsePackageSchemaVersion',
        `must equal supported Response Package version ${RESPONSE_PACKAGE_SCHEMA_VERSION}`,
      );
    }
    if (typeof value.executionId !== 'string' || value.executionId.length === 0) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.source.executionId', 'must be non-empty');
    }
  }

  private validateChangeSet(value: unknown, issues: ChangePlanValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.changeSet', 'must be an object');
      return;
    }
    validateExactKeys(value, ['operations'], '$.changeSet', issues);
    if (!Array.isArray(value.operations)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.changeSet.operations', 'must be an array');
      return;
    }
    if (value.operations.length > this.configuration.maximumOperations) {
      addIssue(
        issues,
        'INVALID_CHANGE_PLAN',
        '$.changeSet.operations',
        `must contain at most ${this.configuration.maximumOperations} operations`,
      );
    }
    value.operations.forEach((operation, index) =>
      this.validateOperation(operation, index, issues),
    );
  }

  private validateOperation(
    value: unknown,
    index: number,
    issues: ChangePlanValidationIssue[],
  ): void {
    const path = `$.changeSet.operations[${index}]`;
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', path, 'must be an object');
      return;
    }
    const hasContent = value.kind === 'CREATE_FILE' || value.kind === 'UPDATE_FILE';
    validateExactKeys(
      value,
      [
        'operationId',
        'kind',
        'logicalPath',
        'artifactType',
        'description',
        'sourceChecksum',
        'sourceSizeBytes',
        ...(hasContent ? ['content'] : []),
      ],
      path,
      issues,
    );
    if (!isChangeOperationKind(value.kind)) {
      addIssue(issues, 'UNSUPPORTED_CHANGE', `${path}.kind`, 'is unsupported');
    }
    if (!isSafeLogicalPath(value.logicalPath)) {
      addIssue(
        issues,
        'INVALID_CHANGE_PLAN',
        `${path}.logicalPath`,
        'must be a normalized repository-relative POSIX path',
      );
    }
    if (
      !['SOURCE_FILE', 'DOCUMENTATION', 'CONFIGURATION', 'TEST'].includes(
        String(value.artifactType),
      )
    ) {
      addIssue(issues, 'UNSUPPORTED_CHANGE', `${path}.artifactType`, 'is unsupported');
    }
    if (typeof value.description !== 'string' || value.description.trim().length === 0) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.description`, 'must be non-empty');
    }
    this.validateChecksum(value.sourceChecksum, `${path}.sourceChecksum`, issues);
    if (!isNonNegativeSafeInteger(value.sourceSizeBytes)) {
      addIssue(
        issues,
        'INVALID_CHANGE_PLAN',
        `${path}.sourceSizeBytes`,
        'must be a non-negative safe integer',
      );
    }
    if (hasContent) {
      if (typeof value.content !== 'string') {
        addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.content`, 'must be a string');
      } else if (
        isNonNegativeSafeInteger(value.sourceSizeBytes) &&
        utf8Size(value.content) !== value.sourceSizeBytes
      ) {
        addIssue(
          issues,
          'INVALID_REFERENCE',
          `${path}.sourceSizeBytes`,
          'must match operation content size',
        );
      }
    } else if (value.kind === 'DELETE_FILE' && value.content !== undefined) {
      addIssue(issues, 'UNSUPPORTED_CHANGE', `${path}.content`, 'is not allowed for deletion');
    }
    if (
      isChangeOperationKind(value.kind) &&
      isSafeLogicalPath(value.logicalPath) &&
      value.operationId !== createOperationId(value.kind, value.logicalPath)
    ) {
      addIssue(
        issues,
        'INVALID_REFERENCE',
        `${path}.operationId`,
        'must be derived from operation kind and logical path',
      );
    }
  }

  private validateChecksum(
    value: unknown,
    path: string,
    issues: ChangePlanValidationIssue[],
  ): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', path, 'must be an object');
      return;
    }
    validateExactKeys(value, ['algorithm', 'value'], path, issues);
    if (typeof value.algorithm !== 'string' || !CHECKSUM_IDENTIFIER_PATTERN.test(value.algorithm)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.algorithm`, 'has an invalid identifier');
    }
    if (typeof value.value !== 'string' || !CHECKSUM_VALUE_PATTERN.test(value.value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.value`, 'must be lowercase hexadecimal');
    }
  }

  private validateSummary(value: unknown, issues: ChangePlanValidationIssue[]): void {
    if (!isRecord(value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.summary', 'must be an object');
      return;
    }
    validateExactKeys(
      value,
      ['filesCreated', 'filesUpdated', 'filesDeleted', 'totalOperations', 'warnings'],
      '$.summary',
      issues,
    );
    for (const key of ['filesCreated', 'filesUpdated', 'filesDeleted', 'warnings'] as const) {
      if (!Array.isArray(value[key]) || !value[key].every((item) => typeof item === 'string')) {
        addIssue(issues, 'INVALID_CHANGE_PLAN', `$.summary.${key}`, 'must be a string array');
      }
    }
    if (!isNonNegativeSafeInteger(value.totalOperations)) {
      addIssue(
        issues,
        'INVALID_CHANGE_PLAN',
        '$.summary.totalOperations',
        'must be a non-negative safe integer',
      );
    }
  }

  private validateRisks(value: unknown, issues: ChangePlanValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.risks', 'must be an array');
      return;
    }
    value.forEach((risk, index) => {
      const path = `$.risks[${index}]`;
      if (!isRecord(risk)) {
        addIssue(issues, 'INVALID_CHANGE_PLAN', path, 'must be an object');
        return;
      }
      validateExactKeys(risk, ['code', 'severity', 'message', 'operationIds'], path, issues);
      this.validateCodeMessageReferences(risk, path, issues);
      if (!isChangeRiskSeverity(risk.severity)) {
        addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.severity`, 'is unsupported');
      }
    });
  }

  private validateWarnings(value: unknown, issues: ChangePlanValidationIssue[]): void {
    if (!Array.isArray(value)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.warnings', 'must be an array');
      return;
    }
    value.forEach((warning, index) => {
      const path = `$.warnings[${index}]`;
      if (!isRecord(warning)) {
        addIssue(issues, 'INVALID_CHANGE_PLAN', path, 'must be an object');
        return;
      }
      validateExactKeys(warning, ['code', 'message', 'operationIds'], path, issues);
      this.validateCodeMessageReferences(warning, path, issues);
    });
  }

  private validateCodeMessageReferences(
    value: Record<string, unknown>,
    path: string,
    issues: ChangePlanValidationIssue[],
  ): void {
    if (typeof value.code !== 'string' || value.code.length === 0) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.code`, 'must be non-empty');
    }
    if (typeof value.message !== 'string' || value.message.length === 0) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.message`, 'must be non-empty');
    }
    if (
      !Array.isArray(value.operationIds) ||
      !value.operationIds.every((item) => typeof item === 'string' && item.length > 0)
    ) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', `${path}.operationIds`, 'must be a string array');
    }
  }

  private validateRelationships(
    value: ProjectChangePlan,
    issues: ChangePlanValidationIssue[],
  ): void {
    try {
      this.conflictDetector.validate(value.changeSet.operations);
    } catch (error: unknown) {
      if (error instanceof ChangePlanValidationError) issues.push(...error.issues);
      else throw error;
    }
    const ordered = this.ordering.order(value.changeSet.operations);
    if (
      ordered.some(
        ({ operationId }, index) => operationId !== value.changeSet.operations[index]?.operationId,
      )
    ) {
      addIssue(
        issues,
        'INVALID_CHANGE_PLAN',
        '$.changeSet.operations',
        'must use canonical create, update, delete, and logical-path order',
      );
    }
    const operationIds = new Set(value.changeSet.operations.map(({ operationId }) => operationId));
    for (const [collectionName, collection] of [
      ['risks', value.risks],
      ['warnings', value.warnings],
    ] as const) {
      collection.forEach((item, index) => {
        item.operationIds.forEach((operationId, referenceIndex) => {
          if (!operationIds.has(operationId)) {
            addIssue(
              issues,
              'INVALID_REFERENCE',
              `$.${collectionName}[${index}].operationIds[${referenceIndex}]`,
              'must reference an operation in the change set',
            );
          }
        });
        if (!isSorted(item.operationIds)) {
          addIssue(
            issues,
            'INVALID_CHANGE_PLAN',
            `$.${collectionName}[${index}].operationIds`,
            'must use canonical order',
          );
        }
      });
    }
    if (!isSorted(value.risks.map(({ code }) => code))) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.risks', 'must use canonical code order');
    }
    const warningKeys = value.warnings.map(({ code, message }) => `${code}\0${message}`);
    if (!isSorted(warningKeys)) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.warnings', 'must use canonical order');
    }
    if (!isSorted(Object.keys(value.metadata))) {
      addIssue(issues, 'INVALID_CHANGE_PLAN', '$.metadata', 'keys must use canonical order');
    }
    const expectedSummary = this.summary.generate(value.changeSet.operations, value.warnings);
    if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
      addIssue(issues, 'INVALID_REFERENCE', '$.summary', 'must match the change set and warnings');
    }
  }
}

function isProjectChangePlanShape(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ProjectChangePlan {
  return (
    isRecord(value.source) &&
    isRecord(value.changeSet) &&
    Array.isArray(value.changeSet.operations) &&
    isRecord(value.summary) &&
    Array.isArray(value.risks) &&
    Array.isArray(value.warnings) &&
    isRecord(value.metadata)
  );
}

function isChangeOperationKind(value: unknown): value is ChangeOperationKind {
  return (
    typeof value === 'string' &&
    CHANGE_OPERATION_KINDS.some((operationKind) => operationKind === value)
  );
}

function isChangeRiskSeverity(value: unknown): value is ChangeRiskSeverity {
  return typeof value === 'string' && CHANGE_RISK_SEVERITIES.some((severity) => severity === value);
}
