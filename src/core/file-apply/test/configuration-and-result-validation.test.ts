import { DEFAULT_FILE_APPLY_CONFIGURATION } from '../config';
import { FILE_SYSTEM_ENTRY_KINDS } from '../ports';
import { FileApplyEngineService, SystemFileApplyClockService } from '../services';
import { FileApplyValidationError } from '../types';
import { FileApplyConfigurationValidator, FileApplyResultValidator } from '../validators';
import {
  createConfiguration,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';

describe('file apply configuration and result validation', () => {
  const configurationValidator = new FileApplyConfigurationValidator();

  it('accepts default and custom protected-path configuration', () => {
    expect(() => configurationValidator.validate(DEFAULT_FILE_APPLY_CONFIGURATION)).not.toThrow();
    expect(() =>
      configurationValidator.validate(
        createConfiguration({
          additionalProtectedPathRules: [
            { id: 'private', kind: 'SUBTREE', path: 'private', rationale: 'Private files' },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('exposes the closed filesystem entry vocabulary and a monotonic platform clock', () => {
    expect(FILE_SYSTEM_ENTRY_KINDS).toEqual(['FILE', 'DIRECTORY', 'SYMLINK', 'OTHER']);
    expect(new SystemFileApplyClockService().now()).toEqual(expect.any(Number));
  });

  it.each([
    null,
    { ...createConfiguration(), maximumOperations: 0 },
    { ...createConfiguration(), maximumOperations: 101 },
    { ...createConfiguration(), additionalProtectedPathRules: 'private' },
    {
      ...createConfiguration(),
      additionalProtectedPathRules: [
        { id: 'Invalid ID', kind: 'GLOB', path: '../escape', rationale: '' },
      ],
    },
    {
      ...createConfiguration(),
      additionalProtectedPathRules: [
        { id: 'git-internals', kind: 'EXACT', path: 'other', rationale: 'Duplicate ID' },
      ],
    },
    {
      ...createConfiguration(),
      additionalProtectedPathRules: [
        { id: 'duplicate-one', kind: 'EXACT', path: 'same', rationale: 'First' },
        { id: 'duplicate-two', kind: 'EXACT', path: 'same', rationale: 'Second' },
      ],
    },
    { ...createConfiguration(), unexpected: true },
  ])('rejects invalid configuration %#', (configuration: unknown) => {
    expect(() => configurationValidator.validate(configuration)).toThrow(FileApplyValidationError);
  });

  it('accepts generated results and rejects version, ordering, overlap, and status drift', async () => {
    const configuration = createConfiguration();
    const fileSystem = new InMemoryFileSystemPort({
      'src/existing.ts': 'old',
      'src/old.ts': 'old',
    });
    const result = await new FileApplyEngineService(
      fileSystem,
      configuration,
      new SequenceClock(),
    ).apply(createPlan());
    const validator = new FileApplyResultValidator(configuration);
    expect(() => validator.validate(result)).not.toThrow();
    expect(() => validator.validate({ ...result, schemaVersion: 2 })).toThrow(
      FileApplyValidationError,
    );
    expect(() =>
      validator.validate({
        ...result,
        status: 'REJECTED',
        skippedFiles: [...result.createdFiles],
      }),
    ).toThrow(FileApplyValidationError);
    expect(() =>
      validator.validate({
        ...result,
        warnings: [...result.warnings].reverse(),
      }),
    ).toThrow(FileApplyValidationError);
  });

  it('enforces the engine-specific operation limit before filesystem inspection', async () => {
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration({ maximumOperations: 1 }),
      new SequenceClock(),
    ).apply(createPlan());
    expect(result.status).toBe('REJECTED');
    expect(fileSystem.inspectionCalls).toEqual([]);
    expect(fileSystem.mutationCalls).toEqual([]);
  });
});
