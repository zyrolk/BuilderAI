import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NodeProjectFileSystem } from '../../../infrastructure/file-system/node-project-file-system';
import {
  normalizeLineEndings,
  readTextBaselineFromRawContent,
  sha256ChecksumOfNormalizedText,
} from '../../../infrastructure/workspace/text-baseline-content';
import { NodeWorkspaceBaseline } from '../../../infrastructure/workspace/node-workspace-baseline';
import { FileApplyEngineService } from '../services';
import {
  baselineChecksumForContent,
  createConfiguration,
  createOperation,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';

function proposedSourceChecksum(content: string) {
  return sha256ChecksumOfNormalizedText(normalizeLineEndings(content));
}

describe('UPDATE_FILE baseline content drift protection', () => {
  it('applies UPDATE_FILE when the on-disk checksum matches baselineContentChecksum', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'baseline A\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
          baselineContentChecksum: baseline,
          sourceChecksum: proposedSourceChecksum('proposed C\n'),
        }),
      ]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.updatedFiles).toEqual(['src/page.html']);
    expect(result.errors).toEqual([]);
    expect(fileSystem.snapshot()).toEqual({ 'src/page.html': 'proposed C\n' });
  });

  it('returns BASELINE_CONTENT_DRIFT when disk content changed after prepare', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
          baselineContentChecksum: baseline,
          sourceChecksum: proposedSourceChecksum('proposed C\n'),
        }),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'BASELINE_CONTENT_DRIFT',
        logicalPath: 'src/page.html',
      }),
    ]);
  });

  it('does not write a drifted UPDATE_FILE operation', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
    await new FileApplyEngineService(fileSystem, createConfiguration(), new SequenceClock()).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('keeps current disk content intact after drift rejection', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
    await new FileApplyEngineService(fileSystem, createConfiguration(), new SequenceClock()).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(fileSystem.snapshot()).toEqual({ 'src/page.html': 'operator B\n' });
  });

  it('still applies legacy UPDATE_FILE operations without baselineContentChecksum', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/legacy.ts': 'old\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('UPDATE_FILE', 'src/legacy.ts', 'new\n')]));

    expect(result.status).toBe('APPLIED');
    expect(result.errors).toEqual([]);
    expect(fileSystem.snapshot()).toEqual({ 'src/legacy.ts': 'new\n' });
  });

  it('leaves CREATE_FILE behavior unchanged when baseline drift protection is enabled elsewhere', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('CREATE_FILE', 'src/new.ts', 'created\n')]));

    expect(result.status).toBe('APPLIED');
    expect(result.createdFiles).toEqual(['src/new.ts']);
    expect(fileSystem.snapshot()).toEqual({ 'src/new.ts': 'created\n' });
  });

  it('leaves DELETE_FILE behavior unchanged when baseline drift protection is enabled elsewhere', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/remove.ts': 'gone\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('DELETE_FILE', 'src/remove.ts')]));

    expect(result.status).toBe('APPLIED');
    expect(result.deletedFiles).toEqual(['src/remove.ts']);
    expect(fileSystem.snapshot()).toEqual({});
  });

  it('treats CRLF on disk as equivalent to LF baseline checksum semantics', async () => {
    const baseline = baselineChecksumForContent('line one\nline two\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/crlf.txt': 'line one\r\nline two\r\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/crlf.txt', 'updated\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.errors).toEqual([]);
  });

  it('compares checksums deterministically by algorithm and value', async () => {
    const baseline = baselineChecksumForContent('stable\n');
    const duplicate = { ...baseline };
    const fileSystem = new InMemoryFileSystemPort({ 'src/stable.ts': 'stable\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/stable.ts', 'next\n', {
          baselineContentChecksum: duplicate,
        }),
      ]),
    );

    expect(result.status).toBe('APPLIED');
  });

  it('follows existing missing-file behavior when the update target disappears before apply', async () => {
    const baseline = baselineChecksumForContent('was here\n');
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/missing.ts', 'next\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.errors.some(({ code }) => code === 'TARGET_MISSING')).toBe(true);
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('rejects symlink update targets during preflight before any drift check', async () => {
    const baseline = baselineChecksumForContent('linked\n');
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.symlinks.add('src/link.ts');
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/link.ts', 'next\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('SYMLINK_REJECTED');
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('rejects protected paths before any mutation or drift check', async () => {
    const baseline = baselineChecksumForContent('protected\n');
    const fileSystem = new InMemoryFileSystemPort({ 'project-brain.json': 'protected\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'project-brain.json', 'blocked\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('PROTECTED_PATH');
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('returns FAILED for a single drifted operation with zero mutations', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(result.createdFiles).toEqual([]);
    expect(result.updatedFiles).toEqual([]);
    expect(result.deletedFiles).toEqual([]);
  });

  it('returns PARTIALLY_APPLIED when an earlier operation succeeds and a later UPDATE drifts', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({
      'src/first.ts': 'first-old\n',
      'src/second.html': 'operator B\n',
    });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('CREATE_FILE', 'src/new.ts', 'created\n'),
        createOperation('UPDATE_FILE', 'src/first.ts', 'first-new\n'),
        createOperation('UPDATE_FILE', 'src/second.html', 'proposed C\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('PARTIALLY_APPLIED');
    expect(result.createdFiles).toEqual(['src/new.ts']);
    expect(result.updatedFiles).toEqual(['src/first.ts']);
    expect(result.skippedFiles).toEqual(['src/second.html']);
    expect(result.errors[0]?.logicalPath).toBe('src/second.html');
    expect(fileSystem.snapshot()).toEqual({
      'src/first.ts': 'first-new\n',
      'src/new.ts': 'created\n',
      'src/second.html': 'operator B\n',
    });
  });

  it('identifies the drifted path in the apply error', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/drifted.ts': 'operator B\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/drifted.ts', 'proposed C\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.errors[0]?.code).toBe('BASELINE_CONTENT_DRIFT');
    expect(result.errors[0]?.logicalPath).toBe('src/drifted.ts');
  });

  it('uses BASELINE_CONTENT_DRIFT as the deterministic error code', async () => {
    const baseline = baselineChecksumForContent('baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.errors.every(({ code }) => code === 'BASELINE_CONTENT_DRIFT')).toBe(true);
  });

  it('does not expose raw baseline or current file content in drift errors', async () => {
    const baseline = baselineChecksumForContent('secret baseline A\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'secret operator B\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'secret proposed C\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    const serialized = JSON.stringify(result.errors);
    expect(serialized).not.toContain('secret baseline A');
    expect(serialized).not.toContain('secret operator B');
    expect(serialized).not.toContain('secret proposed C');
    expect(result.errors[0]?.message).toBe(
      'File content changed after prepare; update was not applied',
    );
  });

  it('does not treat sourceChecksum as a substitute for baselineContentChecksum drift checks', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/page.html': 'operator B\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/page.html', 'proposed C\n', {
          sourceChecksum: baselineChecksumForContent('operator B\n'),
        }),
      ]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.errors).toEqual([]);
    expect(fileSystem.snapshot()).toEqual({ 'src/page.html': 'proposed C\n' });
  });

  it('applies multiple matching UPDATE_FILE operations normally', async () => {
    const firstBaseline = baselineChecksumForContent('first baseline\n');
    const secondBaseline = baselineChecksumForContent('second baseline\n');
    const fileSystem = new InMemoryFileSystemPort({
      'src/first.ts': 'first baseline\n',
      'src/second.ts': 'second baseline\n',
    });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/first.ts', 'first next\n', {
          baselineContentChecksum: firstBaseline,
        }),
        createOperation('UPDATE_FILE', 'src/second.ts', 'second next\n', {
          baselineContentChecksum: secondBaseline,
        }),
      ]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.updatedFiles).toEqual(['src/first.ts', 'src/second.ts']);
    expect(fileSystem.snapshot()).toEqual({
      'src/first.ts': 'first next\n',
      'src/second.ts': 'second next\n',
    });
  });

  it('rejects concurrent manual edits between prepare baseline and apply on real filesystem', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'builderai-drift-'));
    try {
      await mkdir(path.join(root, 'src'), { recursive: true });
      const targetPath = 'src/page.html';
      const baselineContent = 'baseline A\n';
      const operatorContent = 'operator B\n';
      const proposedContent = 'proposed C\n';

      await writeFile(path.join(root, targetPath), baselineContent, 'utf8');
      const baselinePort = new NodeWorkspaceBaseline(root);
      const prepareSnapshot = baselinePort.readTextBaseline(targetPath);
      expect(prepareSnapshot).not.toBeNull();

      await writeFile(path.join(root, targetPath), operatorContent, 'utf8');

      const fileSystem = new NodeProjectFileSystem(root);
      const result = await new FileApplyEngineService(
        fileSystem,
        createConfiguration(),
        new SequenceClock(),
      ).apply(
        createPlan([
          createOperation('UPDATE_FILE', targetPath, proposedContent, {
            baselineContentChecksum: prepareSnapshot!.checksum,
            sourceChecksum: proposedSourceChecksum(proposedContent),
          }),
        ]),
      );

      expect(result.status).toBe('FAILED');
      expect(result.errors).toEqual([
        expect.objectContaining({
          code: 'BASELINE_CONTENT_DRIFT',
          logicalPath: targetPath,
        }),
      ]);
      expect(await readFile(path.join(root, targetPath), 'utf8')).toBe(operatorContent);
      expect(await readFile(path.join(root, targetPath), 'utf8')).not.toBe(proposedContent);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the same checksum helper semantics as NodeWorkspaceBaseline for fixture stability', () => {
    const content = 'shared semantics\n';
    const fixtureChecksum = baselineChecksumForContent(content);
    const helperChecksum = readTextBaselineFromRawContent(content)?.checksum;
    const directChecksum = sha256ChecksumOfNormalizedText(normalizeLineEndings(content));

    expect(fixtureChecksum).toEqual(helperChecksum);
    expect(fixtureChecksum).toEqual(directChecksum);
    expect(fixtureChecksum.value).toBe(
      createHash('sha256').update(normalizeLineEndings(content), 'utf8').digest('hex'),
    );
  });
});
