import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NodeProjectFileSystem } from '../file-system/node-project-file-system';
import { ZYRO_STYLE_FIXTURE_ROOT } from '../../core/target-project/test/external-target.fixture';

describe('external target profile security boundaries', () => {
  it('does not relax filesystem containment for external-target workspaces', async () => {
    const fileSystem = new NodeProjectFileSystem(ZYRO_STYLE_FIXTURE_ROOT);
    await expect(fileSystem.createFileIfAbsent('../outside.ts', 'bad')).rejects.toMatchObject({
      code: 'CREATE_FAILED',
    });
  });

  it('still rejects paths outside the workspace root regardless of profile', async () => {
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'builderai-outside-root-'));
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'builderai-workspace-root-'));
    try {
      writeFileSync(path.join(outsideRoot, 'secret.ts'), 'export const secret = 1;\n', 'utf8');
      mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true });
      writeFileSync(path.join(workspaceRoot, 'src/index.ts'), 'export {};\n', 'utf8');
      const fileSystem = new NodeProjectFileSystem(workspaceRoot);
      await expect(fileSystem.createFileIfAbsent('../secret.ts', 'bad')).rejects.toMatchObject({
        code: 'CREATE_FAILED',
      });
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
