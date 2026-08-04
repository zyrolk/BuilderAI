import { ChangePlannerService } from '../services';
import { UPDATE_SCOPE_PLAN_SCHEMA_VERSION, type UpdateScopePlan } from '../../update-scope';
import {
  createArtifact,
  createConfiguration,
  createResponsePackage,
} from './change-planner.fixture';

function createScopePlan(overrides: Partial<UpdateScopePlan> = {}): UpdateScopePlan {
  return {
    schemaVersion: UPDATE_SCOPE_PLAN_SCHEMA_VERSION,
    mode: 'HARD',
    requiredBaselinePaths: ['index.html'],
    preferredUpdatePaths: ['index.html'],
    preferredMaximumUpdateOperations: 1,
    evidence: [],
    ...overrides,
  };
}

describe('UpdateScopeWarningService integration (ADR-031 Slice 3)', () => {
  const service = new ChangePlannerService(createConfiguration());

  it('emits no scope warnings when HARD index.html only and provider returns index.html only', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: '<html></html>\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update index.html' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan(),
    );

    expect(plan.warnings.some(({ code }) => code === 'SCOPE_DEVIATION')).toBe(false);
    expect(plan.warnings.some(({ code }) => code === 'PREFERRED_OPERATION_COUNT_EXCEEDED')).toBe(
      false,
    );
    expect(plan.metadata['update-scope-mode']).toBe('HARD');
    expect(plan.metadata['update-scope-preferred-paths']).toBe('index.html');
    expect(plan.metadata['update-scope-preferred-maximum-operations']).toBe(1);
  });

  it('emits SCOPE_DEVIATION when HARD index.html only and provider returns index.html + app.js', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: '<html></html>\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update index.html' },
        }),
        createArtifact({
          logicalPath: 'assets/app.js',
          content: 'console.log(true);\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update app.js' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan(),
    );

    const warning = plan.warnings.find(({ code }) => code === 'SCOPE_DEVIATION');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('assets/app.js');
    expect(warning?.message).not.toContain('index.html');
  });

  it('emits PREFERRED_OPERATION_COUNT_EXCEEDED when HARD max operations = 1 and provider returns 3 UPDATEs', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: '<html></html>\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update index.html' },
        }),
        createArtifact({
          logicalPath: 'assets/app.js',
          content: 'console.log(true);\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update app.js' },
        }),
        createArtifact({
          logicalPath: 'assets/styles.css',
          content: 'body {}\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update styles.css' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan(),
    );

    const warning = plan.warnings.find(({ code }) => code === 'PREFERRED_OPERATION_COUNT_EXCEEDED');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('Preferred maximum UPDATE operations: 1');
    expect(warning?.message).toContain('Actual UPDATE operations: 3');
  });

  it('warns on SOFT preferred index.html when provider also updates app.js', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: '<html></html>\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update index.html' },
        }),
        createArtifact({
          logicalPath: 'assets/app.js',
          content: 'console.log(true);\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update app.js' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan({ mode: 'SOFT' }),
    );

    expect(plan.warnings.some(({ code }) => code === 'SCOPE_DEVIATION')).toBe(true);
    expect(plan.changeSet.operations).toHaveLength(2);
  });

  it('emits no scope warnings when scope mode is NONE', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'assets/app.js',
          content: 'console.log(true);\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update app.js' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan({
        mode: 'NONE',
        requiredBaselinePaths: [],
        preferredUpdatePaths: [],
        preferredMaximumUpdateOperations: undefined,
      }),
    );

    expect(plan.warnings.some(({ code }) => code === 'SCOPE_DEVIATION')).toBe(false);
    expect(plan.metadata['update-scope-mode']).toBeUndefined();
  });

  it('does not classify CREATE_FILE outside preferred UPDATE paths as SCOPE_DEVIATION', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'src/new.ts',
          content: 'export const created = true;\n',
          metadata: { 'change-operation': 'CREATE_FILE', description: 'Create file' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan(),
    );

    expect(plan.warnings.some(({ code }) => code === 'SCOPE_DEVIATION')).toBe(false);
  });

  it('leaves DELETE behavior unchanged without scope deviation warnings', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'old/file.ts',
          content: '',
          metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete file' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan(),
    );

    expect(plan.changeSet.operations[0]?.kind).toBe('DELETE_FILE');
    expect(plan.warnings.some(({ code }) => code === 'SCOPE_DEVIATION')).toBe(false);
  });

  it('orders deviated paths deterministically in SCOPE_DEVIATION message', () => {
    const first = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'index.html',
          content: '<html></html>\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update index.html' },
        }),
        createArtifact({
          logicalPath: 'assets/styles.css',
          content: 'body {}\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update styles.css' },
        }),
        createArtifact({
          logicalPath: 'assets/app.js',
          content: 'console.log(true);\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update app.js' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan(),
    );
    const second = structuredClone(first);
    expect(first.warnings.find(({ code }) => code === 'SCOPE_DEVIATION')?.message).toBe(
      second.warnings.find(({ code }) => code === 'SCOPE_DEVIATION')?.message,
    );
    expect(first.warnings.find(({ code }) => code === 'SCOPE_DEVIATION')?.message).toContain(
      'assets/app.js, assets/styles.css',
    );
  });

  it('deduplicates duplicate deviated paths in SCOPE_DEVIATION message', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'assets/app.js',
          content: 'console.log(true);\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update app.js' },
        }),
      ]),
      undefined,
      undefined,
      createScopePlan({ preferredUpdatePaths: ['index.html', 'index.html'] }),
    );

    const warning = plan.warnings.find(({ code }) => code === 'SCOPE_DEVIATION');
    expect(warning?.message.match(/assets\/app\.js/g)?.length).toBe(1);
  });

  it('remains valid for legacy plans without UpdateScopePlan', () => {
    const plan = service.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'assets/app.js',
          content: 'console.log(true);\n',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update app.js' },
        }),
      ]),
    );

    expect(plan.warnings.some(({ code }) => code === 'SCOPE_DEVIATION')).toBe(false);
    expect(plan.metadata['update-scope-mode']).toBeUndefined();
  });
});
