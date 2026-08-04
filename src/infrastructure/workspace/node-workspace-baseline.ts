import path from 'node:path';

import type {
  WorkspaceBaselinePort,
  WorkspaceBaselineSnapshot,
} from '../../core/change-planner/ports/workspace-baseline.port';
import {
  DEFAULT_MAXIMUM_BASELINE_BYTES,
  readTextBaselineFromAbsolutePathSync,
} from './text-baseline-content';

export { DEFAULT_MAXIMUM_BASELINE_BYTES } from './text-baseline-content';

export class NodeWorkspaceBaseline implements WorkspaceBaselinePort {
  constructor(
    private readonly workspaceRoot: string,
    private readonly maximumBaselineBytes: number = DEFAULT_MAXIMUM_BASELINE_BYTES,
  ) {}

  readTextBaseline(logicalPath: string): WorkspaceBaselineSnapshot | null {
    const absolutePath = this.resolveSafeAbsolutePath(logicalPath);
    if (absolutePath === null) return null;

    const snapshot = readTextBaselineFromAbsolutePathSync(absolutePath, this.maximumBaselineBytes);
    if (snapshot === null) return null;

    return {
      logicalPath,
      content: snapshot.content,
      checksum: snapshot.checksum,
      sizeBytes: snapshot.sizeBytes,
    };
  }

  private resolveSafeAbsolutePath(logicalPath: string): string | null {
    if (
      logicalPath.length === 0 ||
      logicalPath.includes('\\') ||
      path.posix.isAbsolute(logicalPath) ||
      /^[A-Za-z]:/.test(logicalPath) ||
      logicalPath
        .split('/')
        .some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      return null;
    }

    const root = path.resolve(this.workspaceRoot);
    const absolutePath = path.resolve(root, logicalPath);
    const relative = path.relative(root, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return absolutePath;
  }
}
