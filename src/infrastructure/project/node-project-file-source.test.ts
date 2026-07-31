import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NodeProjectFileSource } from './node-project-file-source';

describe('NodeProjectFileSource', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'builderai-source-'));
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'src', 'node_modules'));
    await writeFile(path.join(root, 'src', 'a.ts'), 'export {};\n');
    await writeFile(path.join(root, 'src', 'nested', 'b.tsx'), 'export default null;\n');
    await writeFile(path.join(root, 'src', 'ignored.txt'), 'ignore');
    await writeFile(path.join(root, 'src', 'node_modules', 'dependency.ts'), 'ignore');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists supported source files deterministically and reads contained files', async () => {
    const source = new NodeProjectFileSource(root);
    expect(await source.listSourcePaths()).toEqual(['src/a.ts', 'src/nested/b.tsx']);
    expect(await source.readSourceFile('src/a.ts')).toBe('export {};\n');
  });

  it('rejects traversal and symbolic-link source reads', async () => {
    const source = new NodeProjectFileSource(root);
    await expect(source.readSourceFile('../outside.ts')).rejects.toThrow('invalid');
    const link = path.join(root, 'src', 'linked.ts');
    try {
      await symlink(path.join(root, 'src', 'a.ts'), link, 'file');
      await expect(source.readSourceFile('src/linked.ts')).rejects.toThrow('symbolic link');
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'EPERM') {
        return;
      }
      throw error;
    }
  });
});
