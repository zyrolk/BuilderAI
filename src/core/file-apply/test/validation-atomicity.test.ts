import { FileApplyEngineService } from '../services';
import {
  createConfiguration,
  createOperation,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';

describe('pre-apply validation and validation atomicity', () => {
  it('rejects an invalid plan without inspecting or mutating the filesystem', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const plan = createPlan();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply({ ...plan, changeSet: { operations: [...plan.changeSet.operations].reverse() } });
    expect(result.status).toBe('REJECTED');
    expect(result.errors.every(({ code }) => code === 'INVALID_CHANGE_PLAN')).toBe(true);
    expect(fileSystem.inspectionCalls).toEqual([]);
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('preflights every operation and performs zero changes when any target is invalid', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/existing-create.ts': 'already here' });
    const before = fileSystem.snapshot();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('CREATE_FILE', 'src/valid.ts', 'valid'),
        createOperation('CREATE_FILE', 'src/existing-create.ts', 'invalid'),
        createOperation('UPDATE_FILE', 'src/missing-update.ts', 'invalid'),
      ]),
    );
    expect(result.status).toBe('REJECTED');
    expect(result.errors.map(({ code }) => code)).toEqual([
      'TARGET_ALREADY_EXISTS',
      'TARGET_MISSING',
    ]);
    expect(result.skippedFiles).toEqual([
      'src/existing-create.ts',
      'src/missing-update.ts',
      'src/valid.ts',
    ]);
    expect(fileSystem.mutationCalls).toEqual([]);
    expect(fileSystem.snapshot()).toEqual(before);
  });

  it('rejects missing, non-directory, and symlink create parents', async () => {
    const cases = [
      { path: 'missing/file.ts', setup: () => undefined },
      {
        path: 'parent-file/child.ts',
        setup: (fs: InMemoryFileSystemPort) => fs.files.set('parent-file', 'file'),
      },
      {
        path: 'linked/child.ts',
        setup: (fs: InMemoryFileSystemPort) => fs.symlinks.add('linked'),
      },
    ] as const;
    for (const item of cases) {
      const fileSystem = new InMemoryFileSystemPort();
      item.setup(fileSystem);
      const result = await new FileApplyEngineService(
        fileSystem,
        createConfiguration(),
        new SequenceClock(),
      ).apply(createPlan([createOperation('CREATE_FILE', item.path, 'content')]));
      expect(result.status).toBe('REJECTED');
      expect(fileSystem.mutationCalls).toEqual([]);
    }
  });

  it('rejects symlink and non-file update or delete targets', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.symlinks.add('src/link.ts');
    fileSystem.directories.add('src/directory-target');
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/link.ts', 'content'),
        createOperation('DELETE_FILE', 'src/directory-target'),
      ]),
    );
    expect(result.status).toBe('REJECTED');
    expect(result.errors.map(({ code }) => code)).toEqual(['SYMLINK_REJECTED', 'TARGET_NOT_FILE']);
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('turns inspection failures into a rejected zero-change result', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.failInspectionPath = 'src/new.ts';
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('CREATE_FILE', 'src/new.ts', 'new')]));
    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('FILESYSTEM_INSPECTION_FAILED');
    expect(fileSystem.mutationCalls).toEqual([]);
  });
});
