import { WorkspaceRuntimeError } from './workspace-runtime.types';

export class WorkspaceApplyLockService {
  private readonly locks = new Map<string, Map<string, string>>();

  acquire(projectId: string, preparationId: string, logicalPaths: readonly string[]): void {
    const normalizedPaths = [...new Set(logicalPaths.map(normalizePath))].sort(compareText);
    const projectLocks = this.locksForProject(projectId);

    for (const logicalPath of normalizedPaths) {
      const holder = projectLocks.get(logicalPath);
      if (holder !== undefined && holder !== preparationId) {
        throw new WorkspaceRuntimeError(
          'APPLY_PATH_CONFLICT',
          'Another apply is already in progress for one or more target paths.',
        );
      }
    }

    for (const logicalPath of normalizedPaths) {
      projectLocks.set(logicalPath, preparationId);
    }
  }

  release(projectId: string, preparationId: string, logicalPaths: readonly string[]): void {
    const projectLocks = this.locks.get(projectId);
    if (projectLocks === undefined) return;

    for (const logicalPath of logicalPaths) {
      const holder = projectLocks.get(normalizePath(logicalPath));
      if (holder === preparationId) {
        projectLocks.delete(normalizePath(logicalPath));
      }
    }

    if (projectLocks.size === 0) {
      this.locks.delete(projectId);
    }
  }

  private locksForProject(projectId: string): Map<string, string> {
    const existing = this.locks.get(projectId);
    if (existing !== undefined) return existing;
    const created = new Map<string, string>();
    this.locks.set(projectId, created);
    return created;
  }
}

function normalizePath(logicalPath: string): string {
  return logicalPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

export function listChangePlanTargetPaths(
  operations: readonly { readonly logicalPath: string }[],
): readonly string[] {
  return operations.map(({ logicalPath }) => logicalPath);
}
