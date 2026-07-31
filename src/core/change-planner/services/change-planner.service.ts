import {
  ResponsePackageValidator,
  ResponseProcessorValidationError,
  type ResponsePackage,
} from '../../response-processor';
import type { ChangePlannerConfiguration } from '../config';
import { DEFAULT_CHANGE_PLANNER_CONFIGURATION } from '../config';
import {
  ChangePlanValidationError,
  PROJECT_CHANGE_PLAN_SCHEMA_VERSION,
  type ChangeOperationKind,
  type ChangePlanValidationIssue,
  type ProjectChangeOperation,
  type ProjectChangePlan,
} from '../types';
import {
  ChangePlanReferenceValidator,
  ChangePlannerConfigurationValidator,
  ProjectChangePlanValidator,
} from '../validators';
import { ChangeConflictDetectorService } from './change-conflict-detector.service';
import { ChangePlanSummaryService } from './change-plan-summary.service';
import { ChangeRiskService } from './change-risk.service';
import { createOperationId, OperationOrderingService } from './operation-ordering.service';

export class ChangePlannerService {
  private readonly responseValidator: ResponsePackageValidator = new ResponsePackageValidator();
  private readonly configurationValidator: ChangePlannerConfigurationValidator =
    new ChangePlannerConfigurationValidator();
  private readonly conflictDetector = new ChangeConflictDetectorService();
  private readonly ordering = new OperationOrderingService();
  private readonly summary = new ChangePlanSummaryService();
  private readonly risk: ChangeRiskService;
  private readonly planValidator: ProjectChangePlanValidator;
  private readonly referenceValidator: ChangePlanReferenceValidator;

  constructor(
    private readonly configuration: ChangePlannerConfiguration = DEFAULT_CHANGE_PLANNER_CONFIGURATION,
  ) {
    this.configurationValidator.validate(configuration);
    this.risk = new ChangeRiskService(configuration);
    this.planValidator = new ProjectChangePlanValidator(configuration);
    this.referenceValidator = new ChangePlanReferenceValidator(this.planValidator);
  }

  plan(responsePackage: unknown): ProjectChangePlan {
    this.validateResponsePackage(responsePackage);
    const operations = this.createOperations(responsePackage);
    this.conflictDetector.validate(operations);
    const orderedOperations = this.ordering.order(operations);
    const warnings = this.risk.createWarnings(orderedOperations, responsePackage.warnings);
    const plan: ProjectChangePlan = {
      schemaVersion: PROJECT_CHANGE_PLAN_SCHEMA_VERSION,
      source: {
        responsePackageSchemaVersion: responsePackage.schemaVersion,
        executionId: responsePackage.executionResult.executionId,
      },
      changeSet: { operations: orderedOperations },
      summary: this.summary.generate(orderedOperations, warnings),
      risks: this.risk.evaluate(orderedOperations),
      warnings,
      metadata: structuredClone(responsePackage.metadata),
    };
    this.planValidator.validate(plan);
    this.referenceValidator.validate(plan, responsePackage);
    return structuredClone(plan);
  }

  private validateResponsePackage(value: unknown): asserts value is ResponsePackage {
    try {
      this.responseValidator.validate(value);
    } catch (error: unknown) {
      if (error instanceof ResponseProcessorValidationError) {
        throw new ChangePlanValidationError(
          error.issues.map(({ path, message }) => ({
            code: 'INVALID_REFERENCE',
            path: `$.responsePackage${path.slice(1)}`,
            message,
          })),
        );
      }
      throw error;
    }
  }

  private createOperations(responsePackage: ResponsePackage): readonly ProjectChangeOperation[] {
    const issues: ChangePlanValidationIssue[] = [];
    if (responsePackage.generatedArtifacts.length > this.configuration.maximumOperations) {
      issues.push({
        code: 'UNSUPPORTED_CHANGE',
        path: '$.generatedArtifacts',
        message: `must contain at most ${this.configuration.maximumOperations} planned operations`,
      });
    }
    const entries = new Map(
      responsePackage.manifest.entries.map((entry) => [entry.logicalPath, entry] as const),
    );
    const operations: ProjectChangeOperation[] = [];
    responsePackage.generatedArtifacts.forEach((artifact, index) => {
      const path = `$.generatedArtifacts[${index}]`;
      const intent = artifact.metadata['change-operation'];
      if (!isChangeOperationKind(intent)) {
        issues.push({
          code: 'UNSUPPORTED_CHANGE',
          path: `${path}.metadata.change-operation`,
          message: 'must declare CREATE_FILE, UPDATE_FILE, or DELETE_FILE',
        });
        return;
      }
      if (artifact.type === 'PATCH') {
        issues.push({
          code: 'UNSUPPORTED_CHANGE',
          path: `${path}.type`,
          message: 'PATCH artifacts cannot describe an exact file result',
        });
        return;
      }
      if (intent === 'DELETE_FILE' && artifact.content.length !== 0) {
        issues.push({
          code: 'UNSUPPORTED_CHANGE',
          path: `${path}.content`,
          message: 'must be empty for DELETE_FILE intent',
        });
        return;
      }
      const description = artifact.metadata.description;
      const manifestEntry = entries.get(artifact.logicalPath);
      if (
        typeof description !== 'string' ||
        description.trim().length === 0 ||
        manifestEntry === undefined
      ) {
        issues.push({
          code: 'INVALID_REFERENCE',
          path,
          message: 'must have a description and matching manifest entry',
        });
        return;
      }
      const base = {
        operationId: createOperationId(intent, artifact.logicalPath),
        logicalPath: artifact.logicalPath,
        artifactType: artifact.type,
        description,
        sourceChecksum: structuredClone(manifestEntry.checksum),
        sourceSizeBytes: manifestEntry.sizeBytes,
      };
      operations.push(
        intent === 'DELETE_FILE'
          ? { ...base, kind: intent }
          : { ...base, kind: intent, content: artifact.content },
      );
    });
    if (issues.length > 0) throw new ChangePlanValidationError(issues);
    return operations;
  }
}

function isChangeOperationKind(value: unknown): value is ChangeOperationKind {
  return ['CREATE_FILE', 'UPDATE_FILE', 'DELETE_FILE'].includes(String(value));
}
