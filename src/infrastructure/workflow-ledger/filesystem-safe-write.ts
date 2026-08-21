import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { WorkflowLedgerError } from '../../core/workflow-ledger';

export async function assertSafeStatePath(
  stateRoot: string,
  absoluteTarget: string,
): Promise<void> {
  const root = path.resolve(stateRoot);
  const resolved = path.resolve(absoluteTarget);
  const relative = normalizeRelativePath(path.relative(root, resolved));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkflowLedgerError('INVALID_PATH', 'Workflow state path escapes state root.');
  }
  await assertDirectorySafe(root, path.dirname(resolved));
}

export async function writeJsonAtomically(
  stateRoot: string,
  absoluteTarget: string,
  payload: unknown,
): Promise<void> {
  await assertSafeStatePath(stateRoot, absoluteTarget);
  await mkdir(path.dirname(absoluteTarget), { recursive: true });
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  const tempPath = `${absoluteTarget}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, absoluteTarget);
}

export async function appendJsonLineAtomically(
  stateRoot: string,
  absoluteTarget: string,
  payload: unknown,
): Promise<void> {
  await assertSafeStatePath(stateRoot, absoluteTarget);
  await mkdir(path.dirname(absoluteTarget), { recursive: true });
  const line = `${JSON.stringify(payload)}\n`;
  const tempPath = `${absoluteTarget}.${process.pid}.${Date.now()}.append.tmp`;
  let existing = '';
  try {
    existing = await readFile(absoluteTarget, 'utf8');
  } catch (error: unknown) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as Record<string, unknown>).code === 'ENOENT'
    )) {
      throw error;
    }
  }
  await writeFile(tempPath, `${existing}${line}`, 'utf8');
  await rename(tempPath, absoluteTarget);
}

export async function readJsonFile<T>(absoluteTarget: string): Promise<T | undefined> {
  try {
    const raw = await readFile(absoluteTarget, 'utf8');
    if (raw.trim().length === 0) return undefined;
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as Record<string, unknown>).code === 'ENOENT'
    ) {
      return undefined;
    }
    throw new WorkflowLedgerError('CORRUPT_STATE', 'Workflow state file is not valid JSON.');
  }
}

export async function readJsonLines<T>(absoluteTarget: string): Promise<readonly T[]> {
  try {
    const raw = await readFile(absoluteTarget, 'utf8');
    if (raw.trim().length === 0) return [];
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as Record<string, unknown>).code === 'ENOENT'
    ) {
      return [];
    }
    throw new WorkflowLedgerError('CORRUPT_STATE', 'Workflow event log is not valid JSONL.');
  }
}

async function assertDirectorySafe(stateRoot: string, directory: string): Promise<void> {
  const relative = normalizeRelativePath(path.relative(stateRoot, directory));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkflowLedgerError('INVALID_PATH', 'Workflow state directory escapes state root.');
  }
  let current = directory;
  while (current.startsWith(stateRoot)) {
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new WorkflowLedgerError(
          'INVALID_PATH',
          'Workflow state path crosses a symbolic link.',
        );
      }
    } catch (error: unknown) {
      if (error instanceof WorkflowLedgerError) throw error;
      break;
    }
    if (current === stateRoot) break;
    current = path.dirname(current);
  }
}

function normalizeRelativePath(relative: string): string {
  return relative.replaceAll('\\', '/');
}
