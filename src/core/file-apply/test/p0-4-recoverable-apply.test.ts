import { FileApplyEngineService } from '../services';
import {
  createConfiguration,
  createOperation,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';
import { InMemoryFileApplyCheckpoint } from './in-memory-checkpoint';

function createEngineWithCheckpoint(
  fileSystem: InMemoryFileSystemPort,
  checkpoint?: InMemoryFileApplyCheckpoint,
) {
  return new FileApplyEngineService(
    fileSystem,
    createConfiguration(),
    new SequenceClock(),
    checkpoint ?? new InMemoryFileApplyCheckpoint(),
  );
}

describe('P0-4: single-file successful UPDATE', () => {
  it('applies single UPDATE with checkpoint enabled', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/a.ts': 'old\n' });
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([createOperation('UPDATE_FILE', 'src/a.ts', 'new\n')]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.updatedFiles).toEqual(['src/a.ts']);
    expect(fileSystem.snapshot()).toEqual({ 'src/a.ts': 'new\n' });
  });
});

describe('P0-4: multi-file successful UPDATE', () => {
  it('applies multiple UPDATEs with checkpoint enabled', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'old-a\n',
      'src/b.ts': 'old-b\n',
    });
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'new-a\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'new-b\n'),
      ]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.updatedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(fileSystem.snapshot()).toEqual({ 'src/a.ts': 'new-a\n', 'src/b.ts': 'new-b\n' });
  });
});

describe('P0-4: multi-file CREATE + UPDATE + DELETE', () => {
  it('applies all three operation kinds with checkpoint', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/update.ts': 'old\n',
      'src/delete.ts': 'gone\n',
    });
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('CREATE_FILE', 'src/new.ts', 'created\n'),
        createOperation('UPDATE_FILE', 'src/update.ts', 'updated\n'),
        createOperation('DELETE_FILE', 'src/delete.ts'),
      ]),
    );

    expect(result.status).toBe('APPLIED');
    expect(result.createdFiles).toEqual(['src/new.ts']);
    expect(result.updatedFiles).toEqual(['src/update.ts']);
    expect(result.deletedFiles).toEqual(['src/delete.ts']);
    expect(fileSystem.snapshot()).toEqual({
      'src/new.ts': 'created\n',
      'src/update.ts': 'updated\n',
    });
  });
});

describe('P0-4: failure at operation 1 => original state preserved', () => {
  it('preserves original state when first operation fails', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'original\n',
      'src/b.ts': 'original-b\n',
    });
    fileSystem.failMutationPath = 'src/a.ts';
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'new\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'new-b\n'),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(result.createdFiles).toEqual([]);
    expect(result.updatedFiles).toEqual([]);
    expect(fileSystem.snapshot()).toEqual({ 'src/a.ts': 'original\n', 'src/b.ts': 'original-b\n' });
  });
});

describe('P0-4: failure at operation 2 => operation 1 rolled back', () => {
  it('rolls back operation 1 when operation 2 fails', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'original-a\n',
      'src/b.ts': 'original-b\n',
    });
    fileSystem.failMutationPath = 'src/b.ts';
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'new-a\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'new-b\n'),
      ]),
    );

    expect(result.errors.map(({ code }) => code)).toEqual(
      expect.not.arrayContaining(['ROLLBACK_FAILED', 'ROLLBACK_UNSAFE_EXTERNAL_MODIFICATION']),
    );
    expect(result.status).toBe('FAILED');
    expect(result.createdFiles).toEqual([]);
    expect(result.updatedFiles).toEqual([]);
    expect(result.deletedFiles).toEqual([]);
    expect(fileSystem.snapshot()).toEqual({
      'src/a.ts': 'original-a\n',
      'src/b.ts': 'original-b\n',
    });
  });

  it('rolls back CREATE by deleting the created file', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/existing.ts': 'existing\n' });
    fileSystem.failMutationPath = 'src/existing.ts';
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('CREATE_FILE', 'src/new.ts', 'created\n'),
        createOperation('UPDATE_FILE', 'src/existing.ts', 'updated\n'),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(fileSystem.files.has('src/new.ts')).toBe(false);
    expect(fileSystem.snapshot()).toEqual({ 'src/existing.ts': 'existing\n' });
  });
});

describe('P0-4: failure at middle operation N', () => {
  it('rolls back operations 1 and 2 when operation 3 fails', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'orig-a\n',
      'src/b.ts': 'orig-b\n',
      'src/c.ts': 'orig-c\n',
    });
    fileSystem.failMutationPath = 'src/c.ts';
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'new-a\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'new-b\n'),
        createOperation('UPDATE_FILE', 'src/c.ts', 'new-c\n'),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(fileSystem.snapshot()).toEqual({
      'src/a.ts': 'orig-a\n',
      'src/b.ts': 'orig-b\n',
      'src/c.ts': 'orig-c\n',
    });
  });
});

describe('P0-4: rollback failure => explicit RECOVERY_REQUIRED', () => {
  it('returns PARTIALLY_APPLIED with ROLLBACK_FAILED when rollback cannot restore', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'orig-a\n',
      'src/b.ts': 'orig-b\n',
    });
    const checkpoint = new InMemoryFileApplyCheckpoint();
    const engine = createEngineWithCheckpoint(fileSystem, checkpoint);

    const originalUpdate = fileSystem.updateFileIfRegularFile.bind(fileSystem);
    let updateCallCount = 0;
    fileSystem.updateFileIfRegularFile = async (path: string, content: string) => {
      updateCallCount++;
      if (updateCallCount === 2) {
        throw new Error('Simulated fs failure on second UPDATE');
      }
      if (updateCallCount > 2) {
        throw new Error('Simulated rollback failure');
      }
      return originalUpdate(path, content);
    };

    const result = await engine.apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'new-a\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'new-b\n'),
      ]),
    );

    expect(result.status).toBe('PARTIALLY_APPLIED');
    expect(result.errors.some(({ code }) => code === 'ROLLBACK_FAILED')).toBe(true);
  });
});

describe('P0-4: external modification after APPLY blocks rollback', () => {
  it('refuses rollback when external actor modified file after BuilderAI write', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'orig-a\n',
      'src/b.ts': 'orig-b\n',
    });
    const checkpoint = new InMemoryFileApplyCheckpoint();
    const engine = createEngineWithCheckpoint(fileSystem, checkpoint);

    const originalUpdate = fileSystem.updateFileIfRegularFile.bind(fileSystem);
    let updateCallCount = 0;
    fileSystem.updateFileIfRegularFile = async (path: string, content: string) => {
      updateCallCount++;
      if (updateCallCount === 2) {
        throw new Error('Simulated failure on second UPDATE');
      }
      await originalUpdate(path, content);
      if (updateCallCount === 1) {
        fileSystem.files.set('src/a.ts', 'externally-modified\n');
      }
    };

    const result = await engine.apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'new-a\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'new-b\n'),
      ]),
    );

    expect(result.status).toBe('PARTIALLY_APPLIED');
    expect(result.errors.some(({ code }) => code === 'ROLLBACK_UNSAFE_EXTERNAL_MODIFICATION')).toBe(
      true,
    );
    expect(fileSystem.files.get('src/a.ts')).toBe('externally-modified\n');
  });
});

describe('P0-4: existing P0-3 indeterminate-write behavior preserved', () => {
  it('does not attempt rollback on indeterminate mutation', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/target.ts': 'original\n' });
    fileSystem.indeterminateMutationPath = 'src/target.ts';

    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([createOperation('UPDATE_FILE', 'src/target.ts', 'new\n')]),
    );

    expect(result.status).toBe('PARTIALLY_APPLIED');
    expect(result.updatedFiles).toContain('src/target.ts');
    expect(result.errors.some(({ code }) => code === 'INDETERMINATE_MUTATION')).toBe(true);
    expect(result.errors.every(({ code }) => code !== 'ROLLBACK_FAILED')).toBe(true);
  });
});

describe('P0-4: protected paths remain protected', () => {
  it('rejects protected paths even with checkpoint enabled', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'project-brain.json': 'protected\n' });
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([createOperation('UPDATE_FILE', 'project-brain.json', 'blocked\n')]),
    );

    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('PROTECTED_PATH');
  });
});

describe('P0-4: no secrets in recovery metadata', () => {
  it('does not include file content in error messages', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'secret-original\n',
      'src/b.ts': 'secret-other\n',
    });
    fileSystem.failMutationPath = 'src/b.ts';
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'secret-new\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'secret-proposed\n'),
      ]),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('secret-original');
    expect(serialized).not.toContain('secret-new');
    expect(serialized).not.toContain('secret-proposed');
  });
});

describe('P0-4: checkpoint cleanup after successful apply', () => {
  it('clears checkpoint after successful apply', async () => {
    const fileSystem = new InMemoryFileSystemPort({ 'src/a.ts': 'old\n' });
    const checkpoint = new InMemoryFileApplyCheckpoint();
    const engine = createEngineWithCheckpoint(fileSystem, checkpoint);

    await engine.apply(createPlan([createOperation('UPDATE_FILE', 'src/a.ts', 'new\n')]));

    expect(checkpoint.entries()).toEqual([]);
  });
});

describe('P0-4: without checkpoint, behavior is unchanged', () => {
  it('returns PARTIALLY_APPLIED without rollback when no checkpoint provided', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/a.ts': 'orig-a\n',
      'src/b.ts': 'orig-b\n',
    });
    fileSystem.failMutationPath = 'src/b.ts';
    const engine = new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    );
    const result = await engine.apply(
      createPlan([
        createOperation('UPDATE_FILE', 'src/a.ts', 'new-a\n'),
        createOperation('UPDATE_FILE', 'src/b.ts', 'new-b\n'),
      ]),
    );

    expect(result.status).toBe('PARTIALLY_APPLIED');
    expect(fileSystem.files.get('src/a.ts')).toBe('new-a\n');
  });
});

describe('P0-4: rollback of DELETE restores file', () => {
  it('recreates deleted file on rollback', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/keep.ts': 'keep-content\n',
      'src/fail.ts': 'fail-content\n',
    });
    fileSystem.failMutationPath = 'src/fail.ts';
    const result = await createEngineWithCheckpoint(fileSystem).apply(
      createPlan([
        createOperation('DELETE_FILE', 'src/keep.ts'),
        createOperation('DELETE_FILE', 'src/fail.ts'),
      ]),
    );

    expect(result.status).toBe('FAILED');
    expect(fileSystem.files.has('src/keep.ts')).toBe(true);
    expect(fileSystem.files.get('src/keep.ts')).toBe('keep-content\n');
  });
});

describe('P0-4: Gate 2 / server-authoritative ChangePlan preserved', () => {
  it('validates the plan through the standard validator before any checkpoint', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const result = await createEngineWithCheckpoint(fileSystem).apply({
      schemaVersion: 999,
    });

    expect(result.status).toBe('REJECTED');
    expect(result.errors.some(({ code }) => code === 'INVALID_CHANGE_PLAN')).toBe(true);
  });
});
