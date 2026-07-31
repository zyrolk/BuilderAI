import {
  ChangeConflictDetectorService,
  ChangePlannerService,
  OperationOrderingService,
} from '../services';
import { ChangePlanValidationError, type ProjectChangeOperation } from '../types';
import {
  createArtifact,
  createConfiguration,
  createResponsePackage,
  operationFrom,
} from './change-planner.fixture';

describe('change conflict detection and ordering', () => {
  const planner = new ChangePlannerService(createConfiguration());
  const detector = new ChangeConflictDetectorService();

  it('orders create, update, and delete phases and then logical paths', () => {
    const plan = planner.plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'z-delete.ts',
          content: '',
          metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete' },
        }),
        createArtifact({ logicalPath: 'z-create.ts' }),
        createArtifact({ logicalPath: 'a-create.ts' }),
        createArtifact({
          logicalPath: 'a-update.ts',
          metadata: { 'change-operation': 'UPDATE_FILE', description: 'Update' },
        }),
      ]),
    );
    expect(plan.changeSet.operations.map(({ logicalPath }) => logicalPath)).toEqual([
      'a-create.ts',
      'z-create.ts',
      'a-update.ts',
      'z-delete.ts',
    ]);
  });

  it('does not mutate operation input while ordering', () => {
    const operations = planner.plan(createResponsePackage()).changeSet.operations;
    const before = structuredClone(operations);
    expect(new OperationOrderingService().order(operations)).toEqual(before);
    expect(operations).toEqual(before);
  });

  it('detects duplicate IDs, duplicate paths, and conflicting operations', () => {
    const operation = operationFrom(planner.plan(createResponsePackage()));
    expect(() => detector.validate([operation, structuredClone(operation)])).toThrow(
      ChangePlanValidationError,
    );
    if (operation.kind === 'DELETE_FILE') return;
    const conflicting: ProjectChangeOperation = {
      ...operation,
      kind: 'UPDATE_FILE',
      operationId: 'update-file:src/new-file.ts',
    };
    expect(() => detector.validate([operation, conflicting])).toThrow(ChangePlanValidationError);
  });

  it('detects case aliases and file/tree conflicts', () => {
    const operation = operationFrom(planner.plan(createResponsePackage()));
    const caseAlias = {
      ...operation,
      logicalPath: 'SRC/NEW-FILE.ts',
      operationId: 'create-file:src/new-file.ts-alias',
    };
    expect(() => detector.validate([operation, caseAlias])).toThrow(ChangePlanValidationError);
    const child = {
      ...operation,
      logicalPath: `${operation.logicalPath}/child.ts`,
      operationId: 'create-file:src/new-file.ts/child.ts',
    };
    expect(() => detector.validate([operation, child])).toThrow(ChangePlanValidationError);
  });
});
