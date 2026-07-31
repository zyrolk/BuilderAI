import { ChangePlannerService } from '../services';
import { ChangePlanValidationError } from '../types';
import {
  createArtifact,
  createConfiguration,
  createResponsePackage,
} from './change-planner.fixture';

describe('ChangePlannerService', () => {
  const service = new ChangePlannerService(createConfiguration());

  it('generates one deterministic plan for create, update, and delete intents', () => {
    const responsePackage = createResponsePackage([
      createArtifact({
        logicalPath: 'old/file.ts',
        content: '',
        metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete obsolete source' },
      }),
      createArtifact({
        logicalPath: 'src/existing.ts',
        content: 'export const updated = true;\n',
        metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
      }),
      createArtifact({
        logicalPath: 'config/new.json',
        type: 'CONFIGURATION',
        content: '{}\n',
        metadata: { 'change-operation': 'CREATE_FILE', description: 'Create configuration' },
      }),
    ]);
    const before = structuredClone(responsePackage);
    const first = service.plan(responsePackage);
    const second = service.plan(structuredClone(responsePackage));

    expect(first).toEqual(second);
    expect(responsePackage).toEqual(before);
    expect(first.schemaVersion).toBe(1);
    expect(first.source).toEqual({
      responsePackageSchemaVersion: 1,
      executionId: 'execution-change-plan',
    });
    expect(first.changeSet.operations.map(({ kind }) => kind)).toEqual([
      'CREATE_FILE',
      'UPDATE_FILE',
      'DELETE_FILE',
    ]);
    expect(first.summary).toEqual({
      filesCreated: ['config/new.json'],
      filesUpdated: ['src/existing.ts'],
      filesDeleted: ['old/file.ts'],
      totalOperations: 3,
      warnings: ['RESPONSE_REVIEW_OUTPUT', 'UNVERIFIED_PROJECT_STATE'],
    });
    expect(first.risks.map(({ code }) => code)).toEqual([
      'BROAD_CHANGE_SET',
      'CONFIGURATION_CHANGE',
      'DESTRUCTIVE_CHANGE',
    ]);
  });

  it('returns a defensive plan copy', () => {
    const first = service.plan(createResponsePackage());
    Reflect.set(first.changeSet.operations[0] ?? {}, 'logicalPath', 'changed.ts');
    expect(service.plan(createResponsePackage()).changeSet.operations[0]?.logicalPath).toBe(
      'src/new-file.ts',
    );
  });

  it('requires explicit supported intent and exact-result artifact semantics', () => {
    expect(() =>
      service.plan(
        createResponsePackage([
          createArtifact({ metadata: { description: 'Missing operation intent' } }),
        ]),
      ),
    ).toThrow(ChangePlanValidationError);
    expect(() =>
      service.plan(
        createResponsePackage([
          createArtifact({
            type: 'PATCH',
            metadata: { 'change-operation': 'UPDATE_FILE', description: 'Apply a patch' },
          }),
        ]),
      ),
    ).toThrow(ChangePlanValidationError);
    expect(() =>
      service.plan(
        createResponsePackage([
          createArtifact({
            metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete file' },
          }),
        ]),
      ),
    ).toThrow(ChangePlanValidationError);
  });

  it('enforces the configured operation limit', () => {
    const limited = new ChangePlannerService(
      createConfiguration({ maximumOperations: 1, broadChangeOperationThreshold: 1 }),
    );
    expect(() =>
      limited.plan(
        createResponsePackage([
          createArtifact({ logicalPath: 'a.ts' }),
          createArtifact({ logicalPath: 'b.ts' }),
        ]),
      ),
    ).toThrow(ChangePlanValidationError);
  });

  it('translates malformed Response Packages into planner validation errors', () => {
    expect(() => service.plan({ schemaVersion: 99 })).toThrow(ChangePlanValidationError);
  });
});
