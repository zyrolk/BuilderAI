import {
  ChangePlanValidationError,
  ProjectChangePlanValidator,
  type ProjectChangeOperation,
  type ProjectChangePlan,
} from '../../change-planner';
import type { FileApplyConfiguration } from '../config';
import { DEFAULT_FILE_APPLY_CONFIGURATION } from '../config';
import type { FileApplyCheckpointPort, FileApplyClockPort, FileSystemPort } from '../ports';
import {
  FILE_APPLY_RESULT_SCHEMA_VERSION,
  BaselineContentDriftError,
  FileSystemPortError,
  type FileApplyError,
  type FileApplyResult,
  type FileApplyWarning,
} from '../types';
import { FileApplyConfigurationValidator, FileApplyResultValidator } from '../validators';
import { compareText } from '../validators/validation-helpers';
import { artifactChecksumsEqual } from './artifact-checksum-equality';
import { FileApplyPreflightService } from './file-apply-preflight.service';
import { ProtectedPathPolicyService } from './protected-path-policy.service';
import { SystemFileApplyClockService } from './system-file-apply-clock.service';

export class FileApplyEngineService {
  private readonly configurationValidator: FileApplyConfigurationValidator =
    new FileApplyConfigurationValidator();
  private readonly planValidator: ProjectChangePlanValidator = new ProjectChangePlanValidator();
  private readonly resultValidator: FileApplyResultValidator;
  private readonly preflight: FileApplyPreflightService;

  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly configuration: FileApplyConfiguration = DEFAULT_FILE_APPLY_CONFIGURATION,
    private readonly clock: FileApplyClockPort = new SystemFileApplyClockService(),
    private readonly checkpoint?: FileApplyCheckpointPort,
  ) {
    this.configurationValidator.validate(configuration);
    this.resultValidator = new FileApplyResultValidator(configuration);
    this.preflight = new FileApplyPreflightService(
      fileSystem,
      new ProtectedPathPolicyService(configuration),
    );
  }

  async apply(value: unknown): Promise<FileApplyResult> {
    const startedAt = this.clock.now();
    try {
      this.planValidator.validate(value);
    } catch (error: unknown) {
      if (!(error instanceof ChangePlanValidationError)) throw error;
      return this.finalize(
        {
          status: 'REJECTED',
          createdFiles: [],
          updatedFiles: [],
          deletedFiles: [],
          skippedFiles: [],
          warnings: [],
          errors: error.issues.map(({ path, message }) => ({
            code: 'INVALID_CHANGE_PLAN',
            message: `${path} ${message}`,
          })),
          metadata: {},
        },
        startedAt,
      );
    }
    const plan = value;
    if (plan.changeSet.operations.length > this.configuration.maximumOperations) {
      return this.finalize(
        {
          status: 'REJECTED',
          createdFiles: [],
          updatedFiles: [],
          deletedFiles: [],
          skippedFiles: plan.changeSet.operations.map(({ logicalPath }) => logicalPath),
          warnings: this.createWarnings(plan),
          errors: [
            {
              code: 'INVALID_CHANGE_PLAN',
              message: `Plan exceeds the ${this.configuration.maximumOperations} operation limit`,
            },
          ],
          metadata: structuredClone(plan.metadata),
        },
        startedAt,
      );
    }

    const preflightErrors = await this.preflight.validate(plan.changeSet.operations);
    if (preflightErrors.length > 0) {
      return this.finalize(
        {
          status: 'REJECTED',
          createdFiles: [],
          updatedFiles: [],
          deletedFiles: [],
          skippedFiles: plan.changeSet.operations.map(({ logicalPath }) => logicalPath),
          warnings: this.createWarnings(plan),
          errors: preflightErrors,
          metadata: structuredClone(plan.metadata),
        },
        startedAt,
      );
    }

    return this.execute(plan, startedAt);
  }

  private async execute(plan: ProjectChangePlan, startedAt: number): Promise<FileApplyResult> {
    const createdFiles: string[] = [];
    const updatedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const errors: FileApplyError[] = [];
    const operations = plan.changeSet.operations;

    await this.checkpoint?.clear?.();

    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      if (operation === undefined) continue;
      try {
        await this.captureAndExecute(operation);
        if (operation.kind === 'CREATE_FILE') createdFiles.push(operation.logicalPath);
        else if (operation.kind === 'UPDATE_FILE') updatedFiles.push(operation.logicalPath);
        else deletedFiles.push(operation.logicalPath);
      } catch (error: unknown) {
        const isIndeterminate =
          error instanceof FileSystemPortError && error.message === 'INDETERMINATE_MUTATION';
        if (error instanceof BaselineContentDriftError) {
          errors.push({
            code: 'BASELINE_CONTENT_DRIFT',
            message: 'File content changed after prepare; update was not applied',
            logicalPath: error.logicalPath,
            operationId: operation.operationId,
          });
          skippedFiles.push(...operations.slice(index).map(({ logicalPath }) => logicalPath));
        } else if (isIndeterminate) {
          updatedFiles.push(operation.logicalPath);
          errors.push({
            code: 'INDETERMINATE_MUTATION',
            message:
              'Write may have partially mutated the target; recovery must assume mutation occurred',
            logicalPath: error.logicalPath,
            operationId: operation.operationId,
          });
          skippedFiles.push(...operations.slice(index + 1).map(({ logicalPath }) => logicalPath));
        } else {
          errors.push({
            code: 'FILESYSTEM_OPERATION_FAILED',
            message: 'Filesystem mutation failed',
            logicalPath:
              error instanceof FileSystemPortError ? error.logicalPath : operation.logicalPath,
            operationId: operation.operationId,
          });
          skippedFiles.push(...operations.slice(index).map(({ logicalPath }) => logicalPath));
        }
        break;
      }
    }

    const appliedCount = createdFiles.length + updatedFiles.length + deletedFiles.length;
    const hasFailure = errors.length > 0;
    const hasApplied = appliedCount > 0;

    if (hasFailure && hasApplied && this.checkpoint !== undefined && !hasIndeterminate(errors)) {
      const rollbackResult = await this.attemptRollback();
      if (rollbackResult.success) {
        return this.finalize(
          {
            status: 'FAILED',
            createdFiles: [],
            updatedFiles: [],
            deletedFiles: [],
            skippedFiles: operations.map(({ logicalPath }) => logicalPath),
            warnings: this.createWarnings(plan),
            errors: [...errors, ...rollbackResult.errors],
            metadata: structuredClone(plan.metadata),
          },
          startedAt,
        );
      }
      errors.push(...rollbackResult.errors);
    }

    await this.checkpoint?.clear?.();
    return this.finalize(
      {
        status:
          errors.length === 0 ? 'APPLIED' : appliedCount === 0 ? 'FAILED' : 'PARTIALLY_APPLIED',
        createdFiles,
        updatedFiles,
        deletedFiles,
        skippedFiles,
        warnings: this.createWarnings(plan),
        errors,
        metadata: structuredClone(plan.metadata),
      },
      startedAt,
    );
  }

  private async captureAndExecute(operation: ProjectChangeOperation): Promise<void> {
    if (this.checkpoint !== undefined) {
      if (operation.kind === 'CREATE_FILE') {
        await this.checkpoint.captureBaseline(
          operation.logicalPath,
          operation.kind,
          null,
          operation.operationId,
        );
      } else {
        const content = this.fileSystem.readRegularFileContent
          ? await this.fileSystem.readRegularFileContent(operation.logicalPath)
          : null;
        await this.checkpoint.captureBaseline(
          operation.logicalPath,
          operation.kind,
          content,
          operation.operationId,
        );
      }
    }

    await this.executeOperation(operation);

    if (this.checkpoint !== undefined) {
      if (operation.kind === 'DELETE_FILE') {
        await this.checkpoint.recordMutationResult(
          operation.logicalPath,
          operation.kind,
          null,
          operation.operationId,
        );
      } else {
        await this.checkpoint.recordMutationResult(
          operation.logicalPath,
          operation.kind,
          operation.content,
          operation.operationId,
        );
      }
    }
  }

  private async attemptRollback(): Promise<{
    readonly success: boolean;
    readonly errors: readonly FileApplyError[];
  }> {
    const entries = [...this.checkpoint!.entries()].reverse();
    const errors: FileApplyError[] = [];
    let allSucceeded = true;

    for (const entry of entries) {
      try {
        if (entry.kind === 'CREATE_FILE') {
          if (entry.writtenContent !== null) {
            const externalModified = await this.isExternallyModified(
              entry.logicalPath,
              entry.writtenContent,
            );
            if (externalModified) {
              allSucceeded = false;
              errors.push({
                code: 'ROLLBACK_UNSAFE_EXTERNAL_MODIFICATION',
                message:
                  'File was modified by an external actor after BuilderAI write; rollback refused',
                logicalPath: entry.logicalPath,
              });
              continue;
            }
          }
          await this.fileSystem.deleteFileIfRegularFile(entry.logicalPath);
        } else if (entry.kind === 'DELETE_FILE') {
          if (entry.baselineContent !== null) {
            await this.fileSystem.createFileIfAbsent(entry.logicalPath, entry.baselineContent);
          }
        } else {
          if (entry.writtenContent !== null) {
            const externalModified = await this.isExternallyModified(
              entry.logicalPath,
              entry.writtenContent,
            );
            if (externalModified) {
              allSucceeded = false;
              errors.push({
                code: 'ROLLBACK_UNSAFE_EXTERNAL_MODIFICATION',
                message:
                  'File was modified by an external actor after BuilderAI write; rollback refused',
                logicalPath: entry.logicalPath,
              });
              continue;
            }
          }
          if (entry.baselineContent !== null) {
            await this.fileSystem.updateFileIfRegularFile(entry.logicalPath, entry.baselineContent);
          }
        }
      } catch {
        allSucceeded = false;
        errors.push({
          code: 'ROLLBACK_FAILED',
          message: 'Rollback failed; recovery must assume mutation occurred',
          logicalPath: entry.logicalPath,
        });
      }
    }

    return { success: allSucceeded, errors };
  }

  private async isExternallyModified(
    logicalPath: string,
    expectedContent: string,
  ): Promise<boolean> {
    if (!this.fileSystem.readRegularFileContent) return false;
    try {
      const currentContent = await this.fileSystem.readRegularFileContent(logicalPath);
      if (currentContent === null) return true;
      return currentContent !== expectedContent;
    } catch {
      return true;
    }
  }

  private async executeOperation(operation: ProjectChangeOperation): Promise<void> {
    if (operation.kind === 'CREATE_FILE') {
      await this.fileSystem.createFileIfAbsent(operation.logicalPath, operation.content);
      return;
    }
    if (operation.kind === 'UPDATE_FILE') {
      if (operation.baselineContentChecksum !== undefined) {
        const currentChecksum = await this.fileSystem.readRegularFileBaselineChecksum(
          operation.logicalPath,
        );
        if (currentChecksum === null) {
          throw new BaselineContentDriftError(operation.logicalPath);
        }
        if (!artifactChecksumsEqual(currentChecksum, operation.baselineContentChecksum)) {
          throw new BaselineContentDriftError(operation.logicalPath);
        }
      }
      await this.fileSystem.updateFileIfRegularFile(operation.logicalPath, operation.content);
      return;
    }
    if (operation.baselineContentChecksum !== undefined) {
      const currentChecksum = await this.fileSystem.readRegularFileBaselineChecksum(
        operation.logicalPath,
      );
      if (currentChecksum === null) {
        throw new BaselineContentDriftError(operation.logicalPath);
      }
      if (!artifactChecksumsEqual(currentChecksum, operation.baselineContentChecksum)) {
        throw new BaselineContentDriftError(operation.logicalPath);
      }
    }
    await this.fileSystem.deleteFileIfRegularFile(operation.logicalPath);
  }

  private createWarnings(plan: ProjectChangePlan): readonly FileApplyWarning[] {
    return [
      {
        code: 'NON_TRANSACTIONAL_APPLY',
        message:
          'Each filesystem operation is conditional, but completed operations are not rolled back after an execution failure.',
      },
      ...plan.warnings.map(({ code, message }) => ({ code: `PLAN_${code}`, message })),
    ].sort(
      (left, right) =>
        compareText(left.code, right.code) || compareText(left.message, right.message),
    );
  }

  private finalize(
    value: Omit<FileApplyResult, 'schemaVersion' | 'durationMs'>,
    startedAt: number,
  ): FileApplyResult {
    const finishedAt = this.clock.now();
    const durationMs =
      Number.isFinite(startedAt) && Number.isFinite(finishedAt)
        ? Math.max(0, finishedAt - startedAt)
        : 0;
    const result: FileApplyResult = {
      schemaVersion: FILE_APPLY_RESULT_SCHEMA_VERSION,
      ...value,
      createdFiles: [...value.createdFiles].sort(compareText),
      updatedFiles: [...value.updatedFiles].sort(compareText),
      deletedFiles: [...value.deletedFiles].sort(compareText),
      skippedFiles: [...value.skippedFiles].sort(compareText),
      errors: [...value.errors].sort(
        (left, right) =>
          compareText(left.code, right.code) ||
          compareText(left.logicalPath ?? '', right.logicalPath ?? '') ||
          compareText(left.operationId ?? '', right.operationId ?? '') ||
          compareText(left.message, right.message),
      ),
      durationMs,
    };
    this.resultValidator.validate(result);
    return structuredClone(result);
  }
}

function hasIndeterminate(errors: readonly FileApplyError[]): boolean {
  return errors.some(({ code }) => code === 'INDETERMINATE_MUTATION');
}
