import type { ProjectChangeOperation } from '../../change-planner';
import type { FileSystemPort } from '../ports';
import { FileSystemPortError, type FileApplyError } from '../types';
import type { ProtectedPathPolicyService } from './protected-path-policy.service';

export class FileApplyPreflightService {
  constructor(
    private readonly fileSystem: FileSystemPort,
    private readonly protectedPaths: ProtectedPathPolicyService,
  ) {}

  async validate(
    operations: readonly ProjectChangeOperation[],
  ): Promise<readonly FileApplyError[]> {
    const protectedErrors = operations.flatMap((operation) => {
      const match = this.protectedPaths.match(operation.logicalPath);
      return match === null
        ? []
        : [
            {
              code: 'PROTECTED_PATH' as const,
              message: `Protected by rule '${match.ruleId}': ${match.rationale}`,
              logicalPath: operation.logicalPath,
              operationId: operation.operationId,
            },
          ];
    });
    if (protectedErrors.length > 0) return protectedErrors;

    const errors: FileApplyError[] = [];
    for (const operation of operations) {
      try {
        const entry = await this.fileSystem.inspect(operation.logicalPath);
        if (entry?.kind === 'SYMLINK') {
          errors.push(this.error('SYMLINK_REJECTED', operation, 'Symbolic links are not allowed'));
          continue;
        }
        if (operation.kind === 'CREATE_FILE') {
          if (entry !== null) {
            errors.push(
              this.error('TARGET_ALREADY_EXISTS', operation, 'Create target must not exist'),
            );
            continue;
          }
          const parent = await this.fileSystem.inspectParentDirectory(operation.logicalPath);
          if (parent === null) {
            errors.push(
              this.error(
                'PARENT_DIRECTORY_MISSING',
                operation,
                'Create target parent directory must exist',
              ),
            );
          } else if (parent.kind === 'SYMLINK') {
            errors.push(
              this.error('SYMLINK_REJECTED', operation, 'Parent directory must not be a symlink'),
            );
          } else if (parent.kind !== 'DIRECTORY') {
            errors.push(
              this.error(
                'PARENT_NOT_DIRECTORY',
                operation,
                'Create target parent must be a directory',
              ),
            );
          }
          continue;
        }
        if (entry === null) {
          errors.push(this.error('TARGET_MISSING', operation, 'Target file must exist'));
        } else if (entry.kind !== 'FILE') {
          errors.push(this.error('TARGET_NOT_FILE', operation, 'Target must be a regular file'));
        }
      } catch (error: unknown) {
        const logicalPath =
          error instanceof FileSystemPortError ? error.logicalPath : operation.logicalPath;
        errors.push({
          code: 'FILESYSTEM_INSPECTION_FAILED',
          message: 'Filesystem inspection failed',
          logicalPath,
          operationId: operation.operationId,
        });
        break;
      }
    }
    return errors;
  }

  private error(
    code: FileApplyError['code'],
    operation: ProjectChangeOperation,
    message: string,
  ): FileApplyError {
    return {
      code,
      message,
      logicalPath: operation.logicalPath,
      operationId: operation.operationId,
    };
  }
}
