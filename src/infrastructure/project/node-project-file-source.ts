import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProjectFileSource } from '../../core/context-builder';
import {
  EXCLUDED_DIRECTORIES,
  hasIndexableSourceExtension,
  isExcludedFileName,
  isRootConfigFile,
  resolveScanRoots,
  resolveStaticScanRoots,
  type ProjectSourceIndexOptions,
} from './project-source-index-policy';

export class NodeProjectFileSource implements ProjectFileSource {
  private readonly root: string;
  private readonly scanRoots: readonly string[];
  private readonly staticScanRoots: readonly string[];

  constructor(projectRoot: string, options: ProjectSourceIndexOptions = {}) {
    this.root = path.resolve(projectRoot);
    this.scanRoots = resolveScanRoots(
      options.extraScanRoots ?? [],
      options.manifestScanRoots ?? [],
    );
    this.staticScanRoots = resolveStaticScanRoots(options.staticScanRoots ?? []);
  }

  async listSourcePaths(): Promise<readonly string[]> {
    const paths = new Set<string>();
    await this.collectRootLevelFiles(paths);
    for (const scanRoot of this.scanRoots) {
      await this.collect(path.join(this.root, ...scanRoot.split('/')), paths, false);
    }
    for (const scanRoot of this.staticScanRoots) {
      await this.collect(path.join(this.root, ...scanRoot.split('/')), paths, true);
    }
    return [...paths].sort(compareText);
  }

  async readSourceFile(logicalPath: string): Promise<string> {
    const absolutePath = this.resolveContained(logicalPath);
    await this.rejectSymlinkTraversal(absolutePath);
    return readFile(absolutePath, 'utf8');
  }

  private async collectRootLevelFiles(paths: Set<string>): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.root, { withFileTypes: true });
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      if (isRootConfigFile(entry.name)) {
        paths.add(entry.name);
        continue;
      }
      if (isExcludedFileName(entry.name) || !hasIndexableSourceExtension(entry.name, false))
        continue;
      paths.add(entry.name);
    }
  }

  private async collect(directory: string, paths: Set<string>, staticRoot: boolean): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        const entryStat = await lstat(absolutePath);
        if (entryStat.isSymbolicLink()) continue;
        await this.collect(absolutePath, paths, staticRoot);
      } else if (
        entry.isFile() &&
        !isExcludedFileName(entry.name) &&
        hasIndexableSourceExtension(entry.name, staticRoot)
      ) {
        paths.add(path.relative(this.root, absolutePath).replaceAll('\\', '/'));
      }
    }
  }

  private resolveContained(logicalPath: string): string {
    if (
      logicalPath.length === 0 ||
      logicalPath.includes('\\') ||
      path.posix.isAbsolute(logicalPath) ||
      logicalPath
        .split('/')
        .some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error('Source path is invalid.');
    }
    const absolutePath = path.resolve(this.root, logicalPath);
    const relative = path.relative(this.root, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Source path is outside the configured project root.');
    }
    return absolutePath;
  }

  private async rejectSymlinkTraversal(absolutePath: string): Promise<void> {
    const relative = path.relative(this.root, absolutePath);
    let current = this.root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error('Source path traverses a symbolic link.');
    }
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (Reflect.get(error, 'code') as string | undefined)
    : undefined;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
