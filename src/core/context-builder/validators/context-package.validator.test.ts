import { DEFAULT_CONTEXT_LIMITS } from '../types';
import { ContextBuilderValidationError } from '../types';
import { ContextBuilderService } from '../services';
import { createContextInput } from '../test/context-builder.fixture';
import { ContextPackageValidator } from './context-package.validator';

function issuesFrom(action: () => void): readonly string[] {
  try {
    action();
    return [];
  } catch (error: unknown) {
    return error instanceof ContextBuilderValidationError
      ? error.issues.map(({ code }) => code)
      : [];
  }
}

describe('ContextPackageValidator', () => {
  const validator = new ContextPackageValidator();
  const builder = new ContextBuilderService();

  it('rejects duplicate packaged information', async () => {
    const packageValue = await builder.build(await createContextInput());
    const firstFile = packageValue.relevantFiles[0];
    if (firstFile === undefined) throw new Error('Fixture source file is missing.');
    const duplicated = {
      ...packageValue,
      relevantFiles: [
        ...packageValue.relevantFiles,
        { ...firstFile, path: 'src/core/context-builder/duplicate.ts' },
      ],
    };

    expect(issuesFrom(() => validator.validate(duplicated, DEFAULT_CONTEXT_LIMITS))).toContain(
      'DUPLICATE_CONTEXT',
    );
  });

  it('rejects incorrect priority and size metadata', async () => {
    const packageValue = await builder.build(await createContextInput());
    const invalid = {
      ...packageValue,
      priorityOrder: [...packageValue.priorityOrder].reverse(),
      relevantDocumentation: [...packageValue.relevantDocumentation].reverse(),
      size: { ...packageValue.size, files: 99 },
    };

    const codes = issuesFrom(() => validator.validate(invalid, DEFAULT_CONTEXT_LIMITS));
    expect(codes).toContain('CONFLICTING_CONTEXT');
    expect(codes).toContain('CONTEXT_SIZE_EXCEEDED');
  });

  it('rejects missing governance and invalid task, module, and blocker references', async () => {
    const packageValue = await builder.build(await createContextInput());
    const firstFile = packageValue.relevantFiles[0];
    if (firstFile === undefined) throw new Error('Fixture source file is missing.');
    const invalid = {
      ...packageValue,
      relevantDocumentation: packageValue.relevantDocumentation.filter(
        ({ kind }) => kind !== 'ai-rules',
      ),
      relatedTasks: [],
      relevantModules: [],
      relevantFiles: [{ ...firstFile, modulePath: 'missing/module' }],
      openBlockers: [{ taskId: 'missing-task', reason: 'Missing.' }],
    };

    const codes = issuesFrom(() => validator.validate(invalid, DEFAULT_CONTEXT_LIMITS));
    expect(codes).toEqual(
      expect.arrayContaining(['MISSING_REQUIRED_CONTEXT', 'INVALID_REFERENCE']),
    );
  });
});
