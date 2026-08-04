import {
  ResponsePackageValidator,
  ResponseProcessorValidationError,
  type ResponseMetadata,
} from '../../response-processor';
import { ChangePlanValidationError, type ChangePlanValidationIssue } from '../types';
import { ProjectChangePlanValidator } from './project-change-plan.validator';

export class ChangePlanReferenceValidator {
  private readonly responseValidator: ResponsePackageValidator = new ResponsePackageValidator();
  private readonly planValidator: ProjectChangePlanValidator;

  constructor(planValidator: ProjectChangePlanValidator = new ProjectChangePlanValidator()) {
    this.planValidator = planValidator;
  }

  validate(plan: unknown, responsePackage: unknown): void {
    this.planValidator.validate(plan);
    try {
      this.responseValidator.validate(responsePackage);
    } catch (error: unknown) {
      if (error instanceof ResponseProcessorValidationError) {
        throw new ChangePlanValidationError(
          error.issues.map(({ path, message }) => ({
            code: 'INVALID_REFERENCE',
            path: `$.sourceResponse${path.slice(1)}`,
            message,
          })),
        );
      }
      throw error;
    }

    const issues: ChangePlanValidationIssue[] = [];
    if (plan.source.responsePackageSchemaVersion !== responsePackage.schemaVersion) {
      issues.push({
        code: 'INVALID_REFERENCE',
        path: '$.source.responsePackageSchemaVersion',
        message: 'must match the source Response Package',
      });
    }
    if (plan.source.executionId !== responsePackage.executionResult.executionId) {
      issues.push({
        code: 'INVALID_REFERENCE',
        path: '$.source.executionId',
        message: 'must match the source Response Package',
      });
    }
    const entries = new Map(
      responsePackage.manifest.entries.map((entry) => [entry.logicalPath, entry] as const),
    );
    const artifacts = new Map(
      responsePackage.generatedArtifacts.map(
        (artifact) => [artifact.logicalPath, artifact] as const,
      ),
    );
    plan.changeSet.operations.forEach((operation, index) => {
      const path = `$.changeSet.operations[${index}]`;
      const artifact = artifacts.get(operation.logicalPath);
      const entry = entries.get(operation.logicalPath);
      if (artifact === undefined || entry === undefined) {
        issues.push({
          code: 'INVALID_REFERENCE',
          path: `${path}.logicalPath`,
          message: 'must reference one source artifact and manifest entry',
        });
        return;
      }
      const operationIntent = artifact.metadata['change-operation'];
      if (
        operation.kind !== operationIntent ||
        operation.artifactType !== artifact.type ||
        operation.description !== artifact.metadata.description ||
        operation.sourceSizeBytes !== entry.sizeBytes ||
        JSON.stringify(operation.sourceChecksum) !== JSON.stringify(entry.checksum) ||
        (operation.kind === 'DELETE_FILE'
          ? artifact.content.length !== 0
          : operation.content !== artifact.content)
      ) {
        issues.push({
          code: 'INVALID_REFERENCE',
          path,
          message: 'must match its source artifact, manifest entry, and operation intent',
        });
      }
    });
    if (!metadataMatchesPlanExtension(plan.metadata, responsePackage.metadata)) {
      issues.push({
        code: 'INVALID_REFERENCE',
        path: '$.metadata',
        message: 'must match normalized source Response Package metadata',
      });
    }
    if (issues.length > 0) throw new ChangePlanValidationError(issues);
  }
}

function metadataMatchesPlanExtension(
  planMetadata: ResponseMetadata,
  responseMetadata: ResponseMetadata,
): boolean {
  for (const [key, value] of Object.entries(responseMetadata)) {
    if (planMetadata[key] !== value) return false;
  }
  return true;
}
