import { BlueprintReaderService } from '../../core/blueprint-reader';
import { createAppliedResult } from '../../core/verification/test/verification.fixture';
import type { VerificationContext, VerificationStagePortResult } from '../../core/verification';
import { NodeFileSystemDocumentSource } from '../blueprint-reader';
import {
  BoundedNpmCommandRunner,
  NodeBuildRunner,
  NodeDependencyValidator,
  NodeProjectValidator,
  NodeTestRunner,
} from './node-verification-ports';

const context: VerificationContext = {
  fileApplyResult: createAppliedResult(),
  affectedFiles: { created: [], updated: [], deleted: [] },
  metadata: {},
};

describe('Node verification ports', () => {
  it('validates current Project Brain documents through the production reader', async () => {
    const validator = new NodeProjectValidator(
      new BlueprintReaderService(new NodeFileSystemDocumentSource(process.cwd())),
    );
    const result = await validator.validateProject(context);
    expect(result.status).toBe('PASSED');
    expect(result.metadata['document-count']).toBeGreaterThan(0);
  });

  it('runs only explicit shell-free npm arguments and reports safe status metadata', async () => {
    const runner = new BoundedNpmCommandRunner({
      projectRoot: process.cwd(),
      commandTimeoutMs: 30_000,
      maximumOutputBytes: 1_024,
    });
    const result = await runner.run('npm-version', ['--version']);
    expect(result.status).toBe('PASSED');
    expect(result.metadata['exit-code']).toBe(0);
  });

  it('maps each stage wrapper to the bounded runner', async () => {
    const runner = new BoundedNpmCommandRunner({
      projectRoot: process.cwd(),
      commandTimeoutMs: 30_000,
      maximumOutputBytes: 1_024,
    });
    const passed: VerificationStagePortResult = {
      status: 'PASSED',
      warnings: [],
      errors: [],
      metadata: {},
    };
    const run = vi.spyOn(runner, 'run').mockResolvedValue(passed);

    await new NodeDependencyValidator(runner).validateDependencies(context);
    await new NodeBuildRunner(runner).runBuild(context);
    await new NodeTestRunner(runner).runTests(context);

    expect(run.mock.calls.map(([stage]) => stage)).toEqual([
      'dependency-validation',
      'build-validation',
      'test-validation',
    ]);
  });

  it('rejects invalid runner bounds', () => {
    expect(
      () =>
        new BoundedNpmCommandRunner({
          projectRoot: process.cwd(),
          commandTimeoutMs: 0,
          maximumOutputBytes: 1,
        }),
    ).toThrow('invalid');
  });
});
