import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProjectFileSource } from '../../core/context-builder';

const SOURCE_EXTENSIONS = new Set(['.css', '.json', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const EXCLUDED_DIRECTORIES = new Set(['.git', '.next', 'coverage', 'dist', 'node_modules']);

export class NodeProjectFileSource implements ProjectFileSource {
  private readonly root: string;

  constructor(projectRoot: string) {
    this.root = path.resolve(projectRoot);
  }

  async listSourcePaths(): Promise<readonly string[]> {
    const sourceRoot = path.join(this.root, 'src');
    const paths: string[] = [];
    await this.collect(sourceRoot, paths);
    return paths.sort(compareText);
  }

  async readSourceFile(logicalPath: string): Promise<string> {
    const absolutePath = this.resolveContained(logicalPath);
    await this.rejectSymlinkTraversal(absolutePath);
    return readFile(absolutePath, 'utf8');
  }

  private async collect(directory: string, paths: string[]): Promise<void> {
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
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) await this.collect(absolutePath, paths);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        paths.push(path.relative(this.root, absolutePath).replaceAll('\\', '/'));
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
