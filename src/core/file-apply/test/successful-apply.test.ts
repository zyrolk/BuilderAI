import { FileApplyEngineService } from '../services';
import {
  createConfiguration,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';

describe('successful File Apply Engine execution', () => {
  it('applies create, update, and delete operations in deterministic order', async () => {
    const fileSystem = new InMemoryFileSystemPort({
      'src/existing.ts': 'old\n',
      'src/old.ts': 'obsolete\n',
    });
    const plan = createPlan();
    const before = structuredClone(plan);
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(plan);

    expect(result.status).toBe('APPLIED');
    expect(result.createdFiles).toEqual(['src/new.ts']);
    expect(result.updatedFiles).toEqual(['src/existing.ts']);
    expect(result.deletedFiles).toEqual(['src/old.ts']);
    expect(result.skippedFiles).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.durationMs).toBe(25);
    expect(result.metadata).toEqual(plan.metadata);
    expect(result.metadata).not.toBe(plan.metadata);
    expect(result.warnings.map(({ code }) => code)).toEqual([
      'NON_TRANSACTIONAL_APPLY',
      'PLAN_UNVERIFIED_PROJECT_STATE',
    ]);
    expect(fileSystem.mutationCalls).toEqual([
      'create:src/new.ts',
      'update:src/existing.ts',
      'delete:src/old.ts',
    ]);
    expect(fileSystem.snapshot()).toEqual({
      'src/existing.ts': 'updated\n',
      'src/new.ts': 'new\n',
    });
    expect(plan).toEqual(before);
  });

  it('returns an applied no-op result for an empty valid plan', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock([10, 5]),
    ).apply(createPlan([]));
    expect(result.status).toBe('APPLIED');
    expect(result.durationMs).toBe(0);
    expect(fileSystem.mutationCalls).toEqual([]);
  });
});
