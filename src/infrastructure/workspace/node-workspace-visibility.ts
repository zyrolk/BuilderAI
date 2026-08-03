import { lstatSync } from 'node:fs';
import path from 'node:path';

import type { WorkspaceVisibilityPort } from '../../core/change-planner/ports';

type WorkspaceEntryKind = 'FILE' | 'DIRECTORY' | 'OTHER';

export class NodeWorkspaceVisibility implements WorkspaceVisibilityPort {
  constructor(private readonly workspaceRoot: string) {}

  directoryExists(logicalPath: string): boolean {
    return this.entryKind(logicalPath) === 'DIRECTORY';
  }

  fileExists(logicalPath: string): boolean {
    return this.entryKind(logicalPath) === 'FILE';
  }

  /**
   * Uses `lstat` rather than `stat` so a symbolic link is reported as neither an existing file nor an
   * existing directory. This keeps the advisory planning-time signal conservative and consistent with
   * the Safe File Apply Engine, which independently rejects symlinks during its authoritative preflight.
   */
  private entryKind(logicalPath: string): WorkspaceEntryKind | null {
    const absolutePath = path.resolve(this.workspaceRoot, logicalPath);
    try {
      const entry = lstatSync(absolutePath);
      if (entry.isDirectory()) return 'DIRECTORY';
      if (entry.isFile()) return 'FILE';
      return 'OTHER';
    } catch {
      return null;
    }
  }
}
