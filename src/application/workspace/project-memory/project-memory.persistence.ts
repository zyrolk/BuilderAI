import { mkdir, readFile, rename, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  PROJECT_MEMORY_FILE_PATH,
  type ProjectMemoryConfiguration,
} from './project-memory-configuration';
import {
  ProjectMemoryPersistenceError,
  type ExternalTargetProjectMemory,
} from './project-memory.types';
import { assertSafeMemoryRelativePath } from './project-memory-sanitize';
import { normalizeProjectMemoryDocument } from './project-memory.validator';

export class ProjectMemoryPersistence {
  constructor(
    private readonly projectRoot: string,
    private readonly configuration: ProjectMemoryConfiguration = DEFAULT_PROJECT_MEMORY_CONFIGURATION,
  ) {}

  getMemoryFilePath(): string {
    return path.join(this.projectRoot, PROJECT_MEMORY_FILE_PATH);
  }

  async read(expectedProjectId: string): Promise<ExternalTargetProjectMemory> {
    const filePath = this.getMemoryFilePath();
    await assertSafeWritePath(this.projectRoot, filePath);
    try {
      const raw = await readFile(filePath, 'utf8');
      if (raw.trim().length === 0) {
        return emptyMemory(expectedProjectId);
      }
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeProjectMemoryDocument(parsed, expectedProjectId);
      if (normalized.projectId !== expectedProjectId) {
        throw new ProjectMemoryPersistenceError(
          'PROJECT_MISMATCH',
          `Project memory projectId "${normalized.projectId}" does not match target "${expectedProjectId}".`,
        );
      }
      return normalized;
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryPersistenceError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as Record<string, unknown>).code === 'ENOENT'
      ) {
        return emptyMemory(expectedProjectId);
      }
      throw error;
    }
  }

  async write(memory: ExternalTargetProjectMemory): Promise<ExternalTargetProjectMemory> {
    const normalized = normalizeProjectMemoryDocument(memory, memory.projectId);
    const payload = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(payload, 'utf8') > this.configuration.maximumSerializedBytes) {
      throw new ProjectMemoryPersistenceError(
        'INVALID_PATH',
        'Project memory exceeds configured serialized size limit.',
      );
    }
    const filePath = this.getMemoryFilePath();
    await assertSafeWritePath(this.projectRoot, filePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, payload, 'utf8');
    await rename(tempPath, filePath);
    return normalized;
  }
}

function emptyMemory(projectId: string): ExternalTargetProjectMemory {
  return {
    schemaVersion: 1,
    projectId,
    updatedAt: new Date(0).toISOString(),
    decisions: [],
    completedWork: [],
    investigations: [],
    findings: [],
  };
}

export async function assertSafeWritePath(
  projectRoot: string,
  absoluteTarget: string,
): Promise<void> {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(absoluteTarget);
  const relative = normalizeRelativePath(path.relative(root, resolved));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ProjectMemoryPersistenceError(
      'INVALID_PATH',
      'Project memory path is outside project root.',
    );
  }
  assertSafeMemoryRelativePath(relative);
  const directory = path.dirname(resolved);
  await assertDirectorySafe(root, directory);
}

async function assertDirectorySafe(projectRoot: string, directory: string): Promise<void> {
  const relative = normalizeRelativePath(path.relative(projectRoot, directory));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ProjectMemoryPersistenceError(
      'INVALID_PATH',
      'Project memory directory escapes project root.',
    );
  }
  let current = directory;
  while (current.startsWith(projectRoot)) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new ProjectMemoryPersistenceError(
          'INVALID_PATH',
          'Project memory path crosses a symbolic link.',
        );
      }
    } catch (error: unknown) {
      if (error instanceof ProjectMemoryPersistenceError) throw error;
      break;
    }
    if (current === projectRoot) break;
    current = path.dirname(current);
  }
}

function normalizeRelativePath(relative: string): string {
  return relative.replaceAll('\\', '/');
}
