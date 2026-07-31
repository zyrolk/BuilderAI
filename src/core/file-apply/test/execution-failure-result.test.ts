import { FileApplyEngineService } from '../services';
import {
  createConfiguration,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';

describe('filesystem execution failure results', () => {
  it('stops after the first mutation failure and reports partial application without rollback', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/existing.ts': 'old\n',
      'src/old.ts': 'obsolete\n',
    });
    fileSystem.failMutationPath = 'src/existing.ts';
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan());

    expect(result.status).toBe('PARTIALLY_APPLIED');
    expect(result.createdFiles).toEqual(['src/new.ts']);
    expect(result.updatedFiles).toEqual([]);
    expect(result.deletedFiles).toEqual([]);
    expect(result.skippedFiles).toEqual(['src/existing.ts', 'src/old.ts']);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: 'FILESYSTEM_OPERATION_FAILED',
        logicalPath: 'src/existing.ts',
        message: 'Filesystem mutation failed',
      }),
    ]);
    expect(fileSystem.mutationCalls).toEqual(['create:src/new.ts', 'update:src/existing.ts']);
    expect(fileSystem.files.get('src/new.ts')).toBe('new\n');
    expect(fileSystem.files.get('src/old.ts')).toBe('obsolete\n');
  });

  it('reports failed when the first operation fails and skips the complete plan', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/existing.ts': 'old\n',
      'src/old.ts': 'obsolete\n',
    });
    fileSystem.failMutationPath = 'src/new.ts';
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan());
    expect(result.status).toBe('FAILED');
    expect(result.createdFiles).toEqual([]);
    expect(result.skippedFiles).toEqual(['src/existing.ts', 'src/new.ts', 'src/old.ts']);
    expect(fileSystem.mutationCalls).toEqual(['create:src/new.ts']);
  });

  it('maps unknown filesystem failures to a generic safe error', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    fileSystem.createFileIfAbsent = async () => {
      throw new Error('sensitive implementation detail');
    };
    const operation = createPlan().changeSet.operations[0];
    if (operation === undefined) throw new Error('Missing fixture operation');
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([operation]));
    expect(result.status).toBe('FAILED');
    expect(result.errors[0]?.message).toBe('Filesystem mutation failed');
  });
});
