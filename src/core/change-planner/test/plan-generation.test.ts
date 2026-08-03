import { ChangePlannerService } from '../services';
import type { WorkspaceVisibilityPort } from '../ports';
import type { ResponseArtifactType } from '../../response-processor';
import { ChangePlanValidationError } from '../types';
import {
  createArtifact,
  createConfiguration,
  createResponsePackage,
} from './change-planner.fixture';

function fakeVisibility(
  directories: readonly string[],
  files: readonly string[],
): WorkspaceVisibilityPort {
  return {
    directoryExists: (logicalPath) => directories.includes(logicalPath),
    fileExists: (logicalPath) => files.includes(logicalPath),
  };
}

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
            metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete file' },
          }),
        ]),
      ),
    ).toThrow(ChangePlanValidationError);
  });

  it('rejects an artifact type outside the closed contract as a Response Package validation error', () => {
    expect(() =>
      service.plan(
        createResponsePackage([
          {
            ...createArtifact(),
            type: 'PATCH' as unknown as ResponseArtifactType,
            metadata: { 'change-operation': 'UPDATE_FILE', description: 'Apply a patch' },
          },
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

  describe('workspace visibility preconditions', () => {
    it('rejects create-file operations when their parent directory is missing from the workspace', () => {
      const visibility = fakeVisibility(['.'], []);
      const responsePackage = createResponsePackage([
        createArtifact({ logicalPath: 'nested/created-file.ts' }),
      ]);
      expect(() => service.plan(responsePackage, visibility)).toThrow(ChangePlanValidationError);
      try {
        service.plan(responsePackage, visibility);
        throw new Error('expected plan() to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ChangePlanValidationError);
        if (error instanceof ChangePlanValidationError) {
          expect(error.issues).toContainEqual({
            code: 'INVALID_REFERENCE',
            path: '$.generatedArtifacts[0].logicalPath',
            message: "parent directory 'nested' must exist in workspace",
          });
        }
      }
    });

    it('rejects create-file operations when the target already exists in the workspace', () => {
      const visibility = fakeVisibility(['.', 'nested'], ['nested/created-file.ts']);
      const responsePackage = createResponsePackage([
        createArtifact({ logicalPath: 'nested/created-file.ts' }),
      ]);
      expect(() => service.plan(responsePackage, visibility)).toThrow(ChangePlanValidationError);
      try {
        service.plan(responsePackage, visibility);
        throw new Error('expected plan() to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ChangePlanValidationError);
        if (error instanceof ChangePlanValidationError) {
          expect(error.issues).toContainEqual({
            code: 'INVALID_REFERENCE',
            path: '$.generatedArtifacts[0].logicalPath',
            message: "create target 'nested/created-file.ts' must not already exist in workspace",
          });
        }
      }
    });

    it('accepts create-file operations when their parent directory exists and the target is absent', () => {
      const visibility = fakeVisibility(['.', 'nested'], []);
      const responsePackage = createResponsePackage([
        createArtifact({ logicalPath: 'nested/created-file.ts' }),
      ]);
      expect(() => service.plan(responsePackage, visibility)).not.toThrow();
    });

    it('rejects update-file operations when the target is missing from the workspace', () => {
      const visibility = fakeVisibility(['.'], []);
      const responsePackage = createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
        }),
      ]);
      expect(() => service.plan(responsePackage, visibility)).toThrow(ChangePlanValidationError);
      try {
        service.plan(responsePackage, visibility);
        throw new Error('expected plan() to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ChangePlanValidationError);
        if (error instanceof ChangePlanValidationError) {
          expect(error.issues).toContainEqual({
            code: 'INVALID_REFERENCE',
            path: '$.generatedArtifacts[0].logicalPath',
            message: "update target 'src/existing.ts' must exist in workspace",
          });
        }
      }
    });

    it('accepts update-file operations when the target exists in the workspace', () => {
      const visibility = fakeVisibility(['.'], ['src/existing.ts']);
      const responsePackage = createResponsePackage([
        createArtifact({
          logicalPath: 'src/existing.ts',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update existing source' },
        }),
      ]);
      expect(() => service.plan(responsePackage, visibility)).not.toThrow();
    });

    it('rejects delete-file operations when the target is missing from the workspace', () => {
      const visibility = fakeVisibility(['.'], []);
      const responsePackage = createResponsePackage([
        createArtifact({
          logicalPath: 'old/file.ts',
          content: '',
          metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete obsolete source' },
        }),
      ]);
      expect(() => service.plan(responsePackage, visibility)).toThrow(ChangePlanValidationError);
      try {
        service.plan(responsePackage, visibility);
        throw new Error('expected plan() to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(ChangePlanValidationError);
        if (error instanceof ChangePlanValidationError) {
          expect(error.issues).toContainEqual({
            code: 'INVALID_REFERENCE',
            path: '$.generatedArtifacts[0].logicalPath',
            message: "delete target 'old/file.ts' must exist in workspace",
          });
        }
      }
    });

    it('accepts delete-file operations when the target exists in the workspace', () => {
      const visibility = fakeVisibility(['.'], ['old/file.ts']);
      const responsePackage = createResponsePackage([
        createArtifact({
          logicalPath: 'old/file.ts',
          content: '',
          metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete obsolete source' },
        }),
      ]);
      expect(() => service.plan(responsePackage, visibility)).not.toThrow();
    });

    it('prefers the visibility passed to plan() over the one injected through the constructor', () => {
      const constructorVisibility = fakeVisibility(['.', 'nested'], []);
      const callVisibility = fakeVisibility(['.'], []);
      const withConstructorVisibility = new ChangePlannerService(
        createConfiguration(),
        constructorVisibility,
      );
      const responsePackage = createResponsePackage([
        createArtifact({ logicalPath: 'nested/created-file.ts' }),
      ]);

      expect(() => withConstructorVisibility.plan(responsePackage)).not.toThrow();
      expect(() => withConstructorVisibility.plan(responsePackage, callVisibility)).toThrow(
        ChangePlanValidationError,
      );
    });

    it('marks the project state warning as unverified when no visibility is supplied', () => {
      const plan = service.plan(createResponsePackage());
      expect(plan.summary.warnings).toContain('UNVERIFIED_PROJECT_STATE');
      expect(plan.summary.warnings).not.toContain('PARTIALLY_VERIFIED_PROJECT_STATE');
      const warning = plan.warnings.find(({ code }) => code === 'UNVERIFIED_PROJECT_STATE');
      expect(warning?.message).toBe(
        'The planner does not read project state, so create, update, and delete preconditions are not verified.',
      );
    });

    it('marks the project state warning as partially verified when visibility is consulted', () => {
      const visibility = fakeVisibility(['.', 'src'], []);
      const plan = service.plan(createResponsePackage(), visibility);
      expect(plan.summary.warnings).toContain('PARTIALLY_VERIFIED_PROJECT_STATE');
      expect(plan.summary.warnings).not.toContain('UNVERIFIED_PROJECT_STATE');
      const warning = plan.warnings.find(({ code }) => code === 'PARTIALLY_VERIFIED_PROJECT_STATE');
      expect(warning?.message).toBe(
        'The planner checked create, update, and delete target existence against the workspace. Symlinks, permissions, content drift, and concurrent changes remain unverified until Safe File Apply executes.',
      );
    });
  });
});
