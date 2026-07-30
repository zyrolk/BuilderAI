import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DocumentSourcePathError,
  NodeFileSystemDocumentSource,
} from './node-file-system-document-source';

describe('NodeFileSystemDocumentSource', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), 'builderai-reader-'));
    await mkdir(path.join(projectRoot, 'docs', 'nested'), { recursive: true });
    await Promise.all([
      writeFile(path.join(projectRoot, 'project-brain.json'), '{}', 'utf8'),
      writeFile(path.join(projectRoot, 'docs', 'architecture.md'), '# Architecture', 'utf8'),
      writeFile(path.join(projectRoot, 'docs', 'nested', 'notes.md'), '# Notes', 'utf8'),
      writeFile(path.join(projectRoot, 'docs', 'ignored.txt'), 'ignored', 'utf8'),
    ]);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('recursively lists supported project documentation and reads UTF-8 content', async () => {
    const source = new NodeFileSystemDocumentSource(projectRoot);

    expect(await source.listDocumentPaths()).toEqual([
      'docs/architecture.md',
      'docs/nested/notes.md',
      'project-brain.json',
    ]);
    await expect(source.readDocument('docs\\architecture.md')).resolves.toBe('# Architecture');
  });

  it('rejects path traversal outside the configured project root', async () => {
    const source = new NodeFileSystemDocumentSource(projectRoot);

    await expect(source.readDocument('../secret.md')).rejects.toBeInstanceOf(
      DocumentSourcePathError,
    );
  });

  it('returns an empty set when optional canonical locations do not exist', async () => {
    const emptyRoot = await mkdtemp(path.join(tmpdir(), 'builderai-empty-reader-'));
    try {
      await expect(
        new NodeFileSystemDocumentSource(emptyRoot).listDocumentPaths(),
      ).resolves.toEqual([]);
    } finally {
      await rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
