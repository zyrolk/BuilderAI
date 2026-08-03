import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NodeWorkspaceVisibility } from './node-workspace-visibility';

describe('NodeWorkspaceVisibility', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'builderai-workspace-visibility-'));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('reports an existing directory as a directory and not a file', () => {
    mkdirSync(path.join(workspaceRoot, 'nested'));
    const visibility = new NodeWorkspaceVisibility(workspaceRoot);

    expect(visibility.directoryExists('nested')).toBe(true);
    expect(visibility.fileExists('nested')).toBe(false);
  });

  it('reports an existing file as a file and not a directory', () => {
    writeFileSync(path.join(workspaceRoot, 'existing.ts'), 'export const value = 1;\n');
    const visibility = new NodeWorkspaceVisibility(workspaceRoot);

    expect(visibility.fileExists('existing.ts')).toBe(true);
    expect(visibility.directoryExists('existing.ts')).toBe(false);
  });

  it('reports a missing path as neither a file nor a directory', () => {
    const visibility = new NodeWorkspaceVisibility(workspaceRoot);

    expect(visibility.fileExists('missing.ts')).toBe(false);
    expect(visibility.directoryExists('missing')).toBe(false);
  });

  it('treats the workspace root itself as an existing directory', () => {
    const visibility = new NodeWorkspaceVisibility(workspaceRoot);

    expect(visibility.directoryExists('.')).toBe(true);
  });

  it('does not follow symbolic links when checking file or directory existence', () => {
    const targetPath = path.join(workspaceRoot, 'real-file.ts');
    writeFileSync(targetPath, 'export const value = 1;\n');
    const linkPath = path.join(workspaceRoot, 'linked-file.ts');
    try {
      symlinkSync(targetPath, linkPath);
    } catch {
      return;
    }
    const visibility = new NodeWorkspaceVisibility(workspaceRoot);

    expect(visibility.fileExists('linked-file.ts')).toBe(false);
    expect(visibility.directoryExists('linked-file.ts')).toBe(false);
  });

  it('resolves nested logical paths relative to the workspace root', () => {
    mkdirSync(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
    writeFileSync(path.join(workspaceRoot, 'src', 'nested', 'file.ts'), 'export {};\n');
    const visibility = new NodeWorkspaceVisibility(workspaceRoot);

    expect(visibility.directoryExists('src/nested')).toBe(true);
    expect(visibility.fileExists('src/nested/file.ts')).toBe(true);
  });
});
