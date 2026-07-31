import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NodeProjectFileSystem } from './node-project-file-system';

describe('NodeProjectFileSystem', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'builderai-file-system-'));
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'existing.ts'), 'old\n', 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('contains conditional create, update, and delete operations beneath its root', async () => {
    const fileSystem = new NodeProjectFileSystem(root);
    await fileSystem.createFileIfAbsent('src/new.ts', 'new\n');
    await fileSystem.updateFileIfRegularFile('src/existing.ts', 'updated\n');

    expect(await readFile(path.join(root, 'src', 'new.ts'), 'utf8')).toBe('new\n');
    expect(await readFile(path.join(root, 'src', 'existing.ts'), 'utf8')).toBe('updated\n');
    await fileSystem.deleteFileIfRegularFile('src/new.ts');
    expect(await fileSystem.inspect('src/new.ts')).toBeNull();
  });

  it('rejects traversal and conditional precondition failures with typed port errors', async () => {
    const fileSystem = new NodeProjectFileSystem(root);

    await expect(fileSystem.createFileIfAbsent('../outside.ts', 'bad')).rejects.toMatchObject({
      code: 'CREATE_FAILED',
    });
    await expect(fileSystem.createFileIfAbsent('src/existing.ts', 'bad')).rejects.toMatchObject({
      code: 'CREATE_FAILED',
    });
    await expect(fileSystem.updateFileIfRegularFile('src/missing.ts', 'bad')).rejects.toMatchObject(
      {
        code: 'UPDATE_FAILED',
      },
    );
  });
});
