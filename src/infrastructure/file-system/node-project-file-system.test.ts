import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { FileApplyEngineService } from '../../core/file-apply/services';
import { NodeProjectFileSystem } from './node-project-file-system';
import { InMemoryFileApplyCheckpoint } from '../../core/file-apply/test/in-memory-checkpoint';
import {
  createConfiguration,
  createOperation,
  createPlan,
  SequenceClock,
} from '../../core/file-apply/test/file-apply.fixture';

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

  describe('readRegularFileContent', () => {
    it('reads content of a regular file', async () => {
      const fileSystem = new NodeProjectFileSystem(root);
      const content = await fileSystem.readRegularFileContent('src/existing.ts');
      expect(content).toBe('old\n');
    });

    it('returns null for missing file', async () => {
      const fileSystem = new NodeProjectFileSystem(root);
      expect(await fileSystem.readRegularFileContent('src/missing.ts')).toBeNull();
    });

    it.skipIf(process.platform === 'win32')('returns null for symlink target', async () => {
      const fileSystem = new NodeProjectFileSystem(root);
      await symlink(path.join(root, 'src', 'existing.ts'), path.join(root, 'src', 'link.ts'));
      expect(await fileSystem.readRegularFileContent('src/link.ts')).toBeNull();
    });

    it('rejects traversal', async () => {
      const fileSystem = new NodeProjectFileSystem(root);
      await expect(fileSystem.readRegularFileContent('../outside.ts')).rejects.toMatchObject({
        code: 'INSPECTION_FAILED',
      });
    });
  });

  describe('P0-4 rollback with NodeProjectFileSystem', () => {
    it('rolls back successful operation when a subsequent operation fails', async () => {
      const fileSystem = new NodeProjectFileSystem(root);
      await writeFile(path.join(root, 'src', 'second.ts'), 'second-original\n', 'utf8');
      const checkpoint = new InMemoryFileApplyCheckpoint();
      const engine = new FileApplyEngineService(
        fileSystem,
        createConfiguration(),
        new SequenceClock(),
        checkpoint,
      );

      const originalUpdate = fileSystem.updateFileIfRegularFile.bind(fileSystem);
      let callCount = 0;
      fileSystem.updateFileIfRegularFile = async (p: string, c: string) => {
        callCount++;
        if (callCount === 2) throw new Error('Simulated failure on second update');
        return originalUpdate(p, c);
      };

      const result = await engine.apply(
        createPlan([
          createOperation('UPDATE_FILE', 'src/existing.ts', 'updated\n'),
          createOperation('UPDATE_FILE', 'src/second.ts', 'updated-second\n'),
        ]),
      );

      expect(result.status).toBe('FAILED');
      expect(await readFile(path.join(root, 'src', 'existing.ts'), 'utf8')).toBe('old\n');
    });

    it('refuses rollback when external actor modified file after BuilderAI write', async () => {
      const fileSystem = new NodeProjectFileSystem(root);
      await writeFile(path.join(root, 'src', 'second.ts'), 'second-original\n', 'utf8');
      const checkpoint = new InMemoryFileApplyCheckpoint();
      const engine = new FileApplyEngineService(
        fileSystem,
        createConfiguration(),
        new SequenceClock(),
        checkpoint,
      );

      const originalUpdate = fileSystem.updateFileIfRegularFile.bind(fileSystem);
      let callCount = 0;
      fileSystem.updateFileIfRegularFile = async (p: string, c: string) => {
        callCount++;
        await originalUpdate(p, c);
        if (callCount === 1) {
          await writeFile(path.join(root, 'src', 'existing.ts'), 'externally-modified\n', 'utf8');
        }
        if (callCount === 2) {
          throw new Error('Simulated failure');
        }
      };

      const result = await engine.apply(
        createPlan([
          createOperation('UPDATE_FILE', 'src/existing.ts', 'updated\n'),
          createOperation('UPDATE_FILE', 'src/second.ts', 'updated-second\n'),
        ]),
      );

      expect(result.status).toBe('PARTIALLY_APPLIED');
      expect(
        result.errors.some(({ code }) => code === 'ROLLBACK_UNSAFE_EXTERNAL_MODIFICATION'),
      ).toBe(true);
      expect(await readFile(path.join(root, 'src', 'existing.ts'), 'utf8')).toBe(
        'externally-modified\n',
      );
    });
  });
});
