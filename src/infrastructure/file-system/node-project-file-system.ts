import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  FileSystemPortError,
  type FileSystemEntry,
  type FileSystemPort,
} from '../../core/file-apply';
import type { ArtifactChecksum } from '../../core/response-processor';
import {
  DEFAULT_MAXIMUM_BASELINE_BYTES,
  readTextBaselineFromAbsolutePath,
} from '../workspace/text-baseline-content';
import { readFile } from 'node:fs/promises';

const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/iu;

export class NodeProjectFileSystem implements FileSystemPort {
  private readonly root: string;

  constructor(projectRoot: string) {
    this.root = path.resolve(projectRoot);
  }

  async inspect(logicalPath: string): Promise<FileSystemEntry | null> {
    try {
      const absolutePath = this.resolveContained(logicalPath);
      await this.rejectSymlinkAncestors(absolutePath);
      return await inspectEntry(absolutePath);
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return null;
      throw this.portError('INSPECTION_FAILED', logicalPath, error);
    }
  }

  async inspectParentDirectory(logicalPath: string): Promise<FileSystemEntry | null> {
    try {
      const absolutePath = this.resolveContained(logicalPath);
      const parent = path.dirname(absolutePath);
      await this.rejectSymlinkAncestors(parent, true);
      return await inspectEntry(parent);
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return null;
      throw this.portError('INSPECTION_FAILED', logicalPath, error);
    }
  }

  async readRegularFileBaselineChecksum(logicalPath: string): Promise<ArtifactChecksum | null> {
    try {
      const absolutePath = this.resolveContained(logicalPath);
      await this.rejectSymlinkAncestors(absolutePath, true);
      const snapshot = await readTextBaselineFromAbsolutePath(
        absolutePath,
        DEFAULT_MAXIMUM_BASELINE_BYTES,
      );
      return snapshot?.checksum ?? null;
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return null;
      throw this.portError('INSPECTION_FAILED', logicalPath, error);
    }
  }

  async readRegularFileContent(logicalPath: string): Promise<string | null> {
    try {
      const absolutePath = this.resolveContained(logicalPath);
      await this.rejectSymlinkAncestors(absolutePath, true);
      const entry = await lstat(absolutePath);
      if (!entry.isFile() || entry.isSymbolicLink()) return null;
      if (entry.nlink > 1) return null;
      if (entry.size > DEFAULT_MAXIMUM_BASELINE_BYTES) return null;
      const raw = await readFile(absolutePath, 'utf8');
      if (raw.includes('\u0000')) return null;
      return raw;
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return null;
      throw this.portError('INSPECTION_FAILED', logicalPath, error);
    }
  }

  async createFileIfAbsent(logicalPath: string, content: string): Promise<void> {
    const absolutePath = this.resolveForMutation(logicalPath, 'CREATE_FAILED');
    try {
      await this.rejectSymlinkAncestors(absolutePath);
      const handle = await open(absolutePath, 'wx', 0o600);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      throw this.portError('CREATE_FAILED', logicalPath, error);
    }
  }

  async updateFileIfRegularFile(logicalPath: string, content: string): Promise<void> {
    const absolutePath = this.resolveForMutation(logicalPath, 'UPDATE_FAILED');
    let mutationAttempted = false;
    try {
      await this.rejectSymlinkAncestors(absolutePath);
      await this.assertRealPathContained(absolutePath);
      const noFollow = constants.O_NOFOLLOW ?? 0;
      const handle = await open(absolutePath, constants.O_WRONLY | noFollow);
      try {
        const entry = await handle.stat();
        if (!entry.isFile()) throw new Error('Update target is not a regular file.');
        if (entry.nlink > 1) throw new Error('Update target has multiple hard links.');
        mutationAttempted = true;
        await handle.truncate(0);
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (mutationAttempted) {
        throw new FileSystemPortError('UPDATE_FAILED', logicalPath, 'INDETERMINATE_MUTATION');
      }
      throw this.portError('UPDATE_FAILED', logicalPath, error);
    }
  }

  async deleteFileIfRegularFile(logicalPath: string): Promise<void> {
    const absolutePath = this.resolveForMutation(logicalPath, 'DELETE_FAILED');
    try {
      await this.rejectSymlinkAncestors(absolutePath);
      const entry = await lstat(absolutePath);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error('Delete target is not a regular file.');
      }
      if (entry.nlink > 1) {
        throw new Error('Delete target has multiple hard links.');
      }
      const handle = await open(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw new Error('Delete target changed during validation.');
      } finally {
        await handle.close();
      }
      await import('node:fs/promises').then(({ unlink }) => unlink(absolutePath));
    } catch (error: unknown) {
      throw this.portError('DELETE_FAILED', logicalPath, error);
    }
  }

  private resolveForMutation(
    logicalPath: string,
    code: 'CREATE_FAILED' | 'UPDATE_FAILED' | 'DELETE_FAILED',
  ): string {
    try {
      return this.resolveContained(logicalPath);
    } catch (error: unknown) {
      throw this.portError(code, logicalPath, error);
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
      throw new Error('Logical path is invalid.');
    }
    const segments = logicalPath.split('/');
    for (const segment of segments) {
      if (segment.includes(':')) {
        throw new Error('Path segment contains NTFS alternate data stream separator.');
      }
      if (WINDOWS_DEVICE_NAME_PATTERN.test(segment)) {
        throw new Error('Path segment is a reserved Windows device name.');
      }
      if (segment.endsWith('.') || segment.endsWith(' ')) {
        throw new Error('Path segment has trailing dot or space.');
      }
    }
    const absolutePath = path.resolve(this.root, logicalPath);
    this.assertContained(absolutePath);
    return absolutePath;
  }

  private assertContained(absolutePath: string): void {
    const relative = path.relative(this.root, absolutePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Logical path is outside the configured project root.');
    }
  }

  private async rejectSymlinkAncestors(absolutePath: string, includeTarget = false): Promise<void> {
    const relative = path.relative(this.root, absolutePath);
    const segments = relative.split(path.sep).filter(Boolean);
    let current = this.root;
    const limit = includeTarget ? segments.length : Math.max(0, segments.length - 1);
    for (const segment of segments.slice(0, limit)) {
      current = path.join(current, segment);
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error('Logical path traverses a symbolic link.');
    }
  }

  private async assertRealPathContained(absolutePath: string): Promise<void> {
    const resolved = await realpath(absolutePath);
    this.assertContained(resolved);
  }

  private portError(
    code: 'INSPECTION_FAILED' | 'CREATE_FAILED' | 'UPDATE_FAILED' | 'DELETE_FAILED',
    logicalPath: string,
    error: unknown,
  ): FileSystemPortError {
    return error instanceof FileSystemPortError
      ? error
      : new FileSystemPortError(code, logicalPath);
  }
}

async function inspectEntry(absolutePath: string): Promise<FileSystemEntry | null> {
  try {
    const entry = await lstat(absolutePath);
    if (entry.isSymbolicLink()) return { kind: 'SYMLINK' };
    if (entry.isFile()) return { kind: 'FILE' };
    if (entry.isDirectory()) return { kind: 'DIRECTORY' };
    return { kind: 'OTHER' };
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (Reflect.get(error, 'code') as string | undefined)
    : undefined;
}
