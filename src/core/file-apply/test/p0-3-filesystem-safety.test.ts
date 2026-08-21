import { isSafeLogicalPath } from '../../response-processor/validators/generated-artifact.validator';
import { FileApplyEngineService } from '../services';
import {
  baselineChecksumForContent,
  createConfiguration,
  createOperation,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';

describe('P0-3: DELETE baseline content drift protection', () => {
  it('allows DELETE when on-disk checksum matches baselineContentChecksum', async () => {
    const baseline = baselineChecksumForContent('to-delete\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/remove.ts': 'to-delete\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('DELETE_FILE', 'src/remove.ts', '', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.deletedFiles).toEqual(['src/remove.ts']);
    expect(result.errors).toEqual([]);
    expect(fileSystem.snapshot()).toEqual({});
  });

  it('rejects DELETE when on-disk content changed after prepare', async () => {
    const baseline = baselineChecksumForContent('original\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/remove.ts': 'modified\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('DELETE_FILE', 'src/remove.ts', '', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'BASELINE_CONTENT_DRIFT',
        logicalPath: 'src/remove.ts',
      }),
    ]);
    expect(result.deletedFiles).toEqual([]);
    expect(fileSystem.snapshot()).toEqual({ 'src/remove.ts': 'modified\n' });
  });

  it('rejects DELETE when baseline cannot be read (file missing at apply time)', async () => {
    const baseline = baselineChecksumForContent('was-here\n');
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('DELETE_FILE', 'src/gone.ts', '', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('REJECTED');
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('still allows legacy DELETE without baselineContentChecksum', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/old.ts': 'legacy\n' });
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('DELETE_FILE', 'src/old.ts')]));

    expect(result.status).toBe('APPLIED');
    expect(result.deletedFiles).toEqual(['src/old.ts']);
  });
});

describe('P0-3: UPDATE fail-closed on unreadable/missing baseline', () => {
  it('rejects UPDATE when baseline checksum is provided but file cannot be read', async () => {
    const baseline = baselineChecksumForContent('was-here\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/target.ts': 'present\n' });
    fileSystem.files.delete('src/target.ts');
    fileSystem.files.set('src/target.ts', 'present\n');

    const emptyFs = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      emptyFs,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/missing.ts', 'new\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.errors.some(({ code }) => code === 'TARGET_MISSING')).toBe(true);
  });

  it('fails closed when readRegularFileBaselineChecksum returns null for existing file', async () => {
    const baseline = baselineChecksumForContent('baseline\n');
    const fileSystem = new InMemoryFileSystemPort({ 'src/target.ts': 'present\n' });
    fileSystem.readRegularFileBaselineChecksum = async () => null;

    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/target.ts', 'new\n', {
          baselineContentChecksum: baseline,
        }),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(result.errors[0]?.code).toBe('BASELINE_CONTENT_DRIFT');
    expect(fileSystem.mutationCalls).toEqual([]);
  });
});

describe('P0-3: indeterminate UPDATE mutation tracking', () => {
  it('reports PARTIALLY_APPLIED with INDETERMINATE_MUTATION when write fails after partial mutation', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/target.ts': 'original\n' });
    fileSystem.indeterminateMutationPath = 'src/target.ts';

    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('UPDATE_FILE', 'src/target.ts', 'new-content\n')]));

    expect(result.status).toBe('PARTIALLY_APPLIED');
    expect(result.updatedFiles).toContain('src/target.ts');
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'INDETERMINATE_MUTATION',
        logicalPath: 'src/target.ts',
      }),
    ]);
  });

  it('never claims zero-mutation when indeterminate mutation occurs', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/target.ts': 'original\n' });
    fileSystem.indeterminateMutationPath = 'src/target.ts';

    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('UPDATE_FILE', 'src/target.ts', 'new\n')]));

    expect(result.updatedFiles.length).toBeGreaterThan(0);
    expect(result.status).not.toBe('FAILED');
    expect(result.status).not.toBe('REJECTED');
  });
});

describe('P0-3: isSafeLogicalPath Windows path safety', () => {
  it('rejects NTFS alternate data streams', () => {
    expect(isSafeLogicalPath('src/file.txt:Zone.Identifier')).toBe(false);
    expect(isSafeLogicalPath('src/file.txt:hidden:$DATA')).toBe(false);
  });

  it('rejects reserved Windows device names', () => {
    expect(isSafeLogicalPath('CON')).toBe(false);
    expect(isSafeLogicalPath('con')).toBe(false);
    expect(isSafeLogicalPath('PRN')).toBe(false);
    expect(isSafeLogicalPath('AUX')).toBe(false);
    expect(isSafeLogicalPath('NUL')).toBe(false);
    expect(isSafeLogicalPath('COM1')).toBe(false);
    expect(isSafeLogicalPath('LPT1')).toBe(false);
    expect(isSafeLogicalPath('com9')).toBe(false);
    expect(isSafeLogicalPath('lpt9')).toBe(false);
  });

  it('rejects device names with extensions', () => {
    expect(isSafeLogicalPath('CON.txt')).toBe(false);
    expect(isSafeLogicalPath('NUL.js')).toBe(false);
    expect(isSafeLogicalPath('src/CON.txt')).toBe(false);
  });

  it('rejects device names in subdirectories', () => {
    expect(isSafeLogicalPath('src/NUL')).toBe(false);
    expect(isSafeLogicalPath('src/PRN/file.txt')).toBe(false);
  });

  it('still accepts normal paths', () => {
    expect(isSafeLogicalPath('src/console.ts')).toBe(true);
    expect(isSafeLogicalPath('src/printer-service.ts')).toBe(true);
    expect(isSafeLogicalPath('nulify/index.ts')).toBe(true);
  });

  it('rejects trailing dots (Windows alias)', () => {
    expect(isSafeLogicalPath('src/file.')).toBe(false);
    expect(isSafeLogicalPath('src./file.ts')).toBe(false);
  });

  it('rejects trailing spaces (Windows alias)', () => {
    expect(isSafeLogicalPath('src/file ')).toBe(false);
  });
});

describe('P0-3: symlink/persistence safety regression', () => {
  it('rejects symlink targets during preflight', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.symlinks.add('src/link.ts');
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('UPDATE_FILE', 'src/link.ts', 'content\n')]));

    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('SYMLINK_REJECTED');
  });

  it('rejects symlink delete targets during preflight', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.symlinks.add('src/link.ts');
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('DELETE_FILE', 'src/link.ts')]));

    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('SYMLINK_REJECTED');
  });
});
