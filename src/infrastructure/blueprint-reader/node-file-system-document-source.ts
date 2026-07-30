import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { normalizeDocumentPath, type DocumentSource } from '@/core/blueprint-reader';

const SUPPORTED_EXTENSIONS = new Set(['.json', '.md']);

export class DocumentSourcePathError extends Error {
  readonly code = 'DOCUMENT_SOURCE_PATH_INVALID';

  constructor(readonly documentPath: string) {
    super(`Document path '${documentPath}' is outside the project root.`);
    this.name = 'DocumentSourcePathError';
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export class NodeFileSystemDocumentSource implements DocumentSource {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
  }

  async listDocumentPaths(): Promise<readonly string[]> {
    const documents: string[] = [];
    const projectBrainPath = path.join(this.projectRoot, 'project-brain.json');
    if (await exists(projectBrainPath)) documents.push('project-brain.json');

    const docsPath = path.join(this.projectRoot, 'docs');
    if (await exists(docsPath)) await this.collectDocuments(docsPath, documents);
    return documents.sort();
  }

  async readDocument(documentPath: string): Promise<string> {
    const normalized = normalizeDocumentPath(documentPath);
    const absolutePath = path.resolve(this.projectRoot, normalized);
    const relativePath = path.relative(this.projectRoot, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new DocumentSourcePathError(documentPath);
    }
    return readFile(absolutePath, 'utf8');
  }

  private async collectDocuments(directory: string, documents: string[]): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await this.collectDocuments(absolutePath, documents);
          return;
        }
        if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name))) return;
        documents.push(normalizeDocumentPath(path.relative(this.projectRoot, absolutePath)));
      }),
    );
  }
}
