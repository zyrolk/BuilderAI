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
import type { WorkspaceBaselinePort, WorkspaceVisibilityPort } from '../ports';
import {
  ChangePlanReferenceValidator,
  ChangePlannerConfigurationValidator,
  ProjectChangePlanValidator,
} from '../validators';
import { ChangeConflictDetectorService } from './change-conflict-detector.service';
import { ChangePlanSummaryService } from './change-plan-summary.service';
import { ChangePreservationService } from './change-preservation.service';
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
  private readonly preservation: ChangePreservationService;
  private readonly planValidator: ProjectChangePlanValidator;
  private readonly referenceValidator: ChangePlanReferenceValidator;

  constructor(
    private readonly configuration: ChangePlannerConfiguration = DEFAULT_CHANGE_PLANNER_CONFIGURATION,
    private readonly workspaceVisibility?: WorkspaceVisibilityPort,
    private readonly workspaceBaseline?: WorkspaceBaselinePort,
  ) {
    this.configurationValidator.validate(configuration);
    this.risk = new ChangeRiskService(configuration);
    this.preservation = new ChangePreservationService(configuration);
    this.planValidator = new ProjectChangePlanValidator(configuration);
    this.referenceValidator = new ChangePlanReferenceValidator(this.planValidator);
  }

  plan(
    responsePackage: unknown,
    workspaceVisibility?: WorkspaceVisibilityPort,
    workspaceBaseline?: WorkspaceBaselinePort,
  ): ProjectChangePlan {
    this.validateResponsePackage(responsePackage);
    const resolvedVisibility = workspaceVisibility ?? this.workspaceVisibility;
    const resolvedBaseline = workspaceBaseline ?? this.workspaceBaseline;
    const operations = this.createOperations(responsePackage, resolvedVisibility);
    const preservationResult =
      resolvedBaseline === undefined
        ? { operations, warnings: [], risks: [] }
        : this.preservation.enrichOperations(operations, resolvedBaseline);
    this.conflictDetector.validate(preservationResult.operations);
    const orderedOperations = this.ordering.order(preservationResult.operations);
    const warnings = this.risk.createWarnings(
      orderedOperations,
      responsePackage.warnings,
      resolvedVisibility !== undefined,
      preservationResult.warnings,
    );
    const plan: ProjectChangePlan = {
      schemaVersion: PROJECT_CHANGE_PLAN_SCHEMA_VERSION,
      source: {
        responsePackageSchemaVersion: responsePackage.schemaVersion,
        executionId: responsePackage.executionResult.executionId,
      },
      changeSet: { operations: orderedOperations },
      summary: this.summary.generate(orderedOperations, warnings),
      risks: [...this.risk.evaluate(orderedOperations), ...preservationResult.risks].sort(
        (left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0),
      ),
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

  private createOperations(
    responsePackage: ResponsePackage,
    workspaceVisibility?: WorkspaceVisibilityPort,
  ): readonly ProjectChangeOperation[] {
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
      if (workspaceVisibility !== undefined) {
        const visibilityIssue = checkWorkspacePrecondition(
          intent,
          artifact.logicalPath,
          workspaceVisibility,
          `${path}.logicalPath`,
        );
        if (visibilityIssue !== null) {
          issues.push(visibilityIssue);
          return;
        }
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

function parentDirectoryFor(logicalPath: string): string {
  const parent = logicalPath.includes('/')
    ? logicalPath.slice(0, logicalPath.lastIndexOf('/'))
    : '.';
  return parent === '' ? '.' : parent;
}

/**
 * Mirrors the Safe File Apply Engine's own preconditions (absent create target with an existing
 * parent directory; an existing regular file for update and delete) so a plan the workspace already
 * disagrees with is rejected at planning time instead of only failing later during apply.
 */
function checkWorkspacePrecondition(
  intent: ChangeOperationKind,
  logicalPath: string,
  workspaceVisibility: WorkspaceVisibilityPort,
  issuePath: string,
): ChangePlanValidationIssue | null {
  if (intent === 'CREATE_FILE') {
    if (workspaceVisibility.fileExists(logicalPath)) {
      return {
        code: 'INVALID_REFERENCE',
        path: issuePath,
        message: `create target '${logicalPath}' must not already exist in workspace`,
      };
    }
    const parentPath = parentDirectoryFor(logicalPath);
    if (!workspaceVisibility.directoryExists(parentPath)) {
      return {
        code: 'INVALID_REFERENCE',
        path: issuePath,
        message: `parent directory '${parentPath}' must exist in workspace`,
      };
    }
    return null;
  }
  if (!workspaceVisibility.fileExists(logicalPath)) {
    return {
      code: 'INVALID_REFERENCE',
      path: issuePath,
      message: `${intent === 'UPDATE_FILE' ? 'update' : 'delete'} target '${logicalPath}' must exist in workspace`,
    };
  }
  return null;
}
