import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_MAXIMUM_BASELINE_BYTES, NodeWorkspaceBaseline } from './node-workspace-baseline';

describe('NodeWorkspaceBaseline', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'builderai-workspace-baseline-'));
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('reads a valid project-relative text file', () => {
    writeFileSync(path.join(workspaceRoot, 'readme.txt'), 'hello baseline\n');
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);
    const snapshot = baseline.readTextBaseline('readme.txt');

    expect(snapshot).not.toBeNull();
    expect(snapshot?.logicalPath).toBe('readme.txt');
    expect(snapshot?.content).toBe('hello baseline\n');
    expect(snapshot?.checksum.algorithm).toBe('sha256');
    expect(snapshot?.checksum.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reads a nested project-relative text file', () => {
    mkdirSync(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
    writeFileSync(path.join(workspaceRoot, 'src', 'nested', 'file.ts'), 'export {};\n');
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    const snapshot = baseline.readTextBaseline('src/nested/file.ts');

    expect(snapshot).not.toBeNull();
    expect(snapshot?.content).toBe('export {};\n');
  });

  it('returns null for absolute paths', () => {
    writeFileSync(path.join(workspaceRoot, 'existing.ts'), 'export {};\n');
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('/existing.ts')).toBeNull();
    expect(baseline.readTextBaseline('C:/existing.ts')).toBeNull();
  });

  it('returns null for parent traversal paths', () => {
    writeFileSync(path.join(workspaceRoot, 'existing.ts'), 'export {};\n');
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('../existing.ts')).toBeNull();
    expect(baseline.readTextBaseline('src/../../existing.ts')).toBeNull();
  });

  it('returns null for directories', () => {
    mkdirSync(path.join(workspaceRoot, 'nested'));
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('nested')).toBeNull();
  });

  it('returns null for missing files', () => {
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('missing.ts')).toBeNull();
  });

  it('returns null for symbolic links', () => {
    const targetPath = path.join(workspaceRoot, 'real-file.ts');
    writeFileSync(targetPath, 'export const value = 1;\n');
    const linkPath = path.join(workspaceRoot, 'linked-file.ts');
    try {
      symlinkSync(targetPath, linkPath);
    } catch {
      return;
    }
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('linked-file.ts')).toBeNull();
  });

  it('returns null for files larger than 512 KiB', () => {
    const oversized = 'a'.repeat(DEFAULT_MAXIMUM_BASELINE_BYTES + 1);
    writeFileSync(path.join(workspaceRoot, 'large.txt'), oversized, 'utf8');
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('large.txt')).toBeNull();
  });

  it('returns null for binary content', () => {
    writeFileSync(path.join(workspaceRoot, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02]));
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('binary.bin')).toBeNull();
  });

  it('reads UTF-8 text successfully', () => {
    writeFileSync(path.join(workspaceRoot, 'unicode.txt'), 'café — 日本語\n', 'utf8');
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);
    const snapshot = baseline.readTextBaseline('unicode.txt');

    expect(snapshot?.content).toBe('café — 日本語\n');
  });

  it('does not read outside the configured project root', () => {
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), 'builderai-outside-root-'));
    try {
      writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside secret\n');
      const linkInsideRoot = path.join(workspaceRoot, 'escape.txt');
      try {
        symlinkSync(path.join(outsideRoot, 'secret.txt'), linkInsideRoot);
      } catch {
        const baseline = new NodeWorkspaceBaseline(workspaceRoot);
        expect(baseline.readTextBaseline('../../secret.txt')).toBeNull();
        return;
      }
      const baseline = new NodeWorkspaceBaseline(workspaceRoot);
      expect(baseline.readTextBaseline('escape.txt')).toBeNull();
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('normalizes CRLF line endings in returned content', () => {
    writeFileSync(path.join(workspaceRoot, 'crlf.txt'), 'line one\r\nline two\r\n');
    const baseline = new NodeWorkspaceBaseline(workspaceRoot);

    expect(baseline.readTextBaseline('crlf.txt')?.content).toBe('line one\nline two\n');
  });
});
