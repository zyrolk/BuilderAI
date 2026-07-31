import { createOperation } from './file-apply.fixture';
import { ProtectedPathPolicyService, FileApplyEngineService } from '../services';
import {
  createConfiguration,
  createPlan,
  InMemoryFileSystemPort,
  SequenceClock,
} from './file-apply.fixture';

describe('protected path policy', () => {
  it.each([
    'project-brain.json',
    '.git/config',
    '.ENV.local',
    'AGENTS.md',
    '.github/workflows/ci.yml',
  ])('rejects mandatory protected path %s before filesystem inspection', async (logicalPath) => {
    const fileSystem = new InMemoryFileSystemPort();
    const result = await new FileApplyEngineService(
      fileSystem,
      createConfiguration(),
      new SequenceClock(),
    ).apply(createPlan([createOperation('CREATE_FILE', logicalPath, 'content')]));
    expect(result.status).toBe('REJECTED');
    expect(result.errors[0]?.code).toBe('PROTECTED_PATH');
    expect(fileSystem.inspectionCalls).toEqual([]);
    expect(fileSystem.mutationCalls).toEqual([]);
  });

  it('supports additional exact, subtree, and path-prefix rules', () => {
    const policy = new ProtectedPathPolicyService(
      createConfiguration({
        additionalProtectedPathRules: [
          { id: 'exact', kind: 'EXACT', path: 'exact.txt', rationale: 'Exact' },
          { id: 'subtree', kind: 'SUBTREE', path: 'private', rationale: 'Subtree' },
          { id: 'prefix', kind: 'PATH_PREFIX', path: 'secret-', rationale: 'Prefix' },
        ],
      }),
    );
    expect(policy.match('EXACT.txt')?.ruleId).toBe('exact');
    expect(policy.match('private/nested.txt')?.ruleId).toBe('subtree');
    expect(policy.match('secret-value.txt')?.ruleId).toBe('prefix');
    expect(policy.match('public/value.txt')).toBeNull();
  });
});
