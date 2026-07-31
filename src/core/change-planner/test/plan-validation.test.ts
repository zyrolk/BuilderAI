import { ChangePlannerService } from '../services';
import { ChangePlanValidationError } from '../types';
import { ProjectChangePlanValidator } from '../validators';
import { createConfiguration, createResponsePackage } from './change-planner.fixture';

describe('ProjectChangePlanValidator', () => {
  const configuration = createConfiguration();
  const planner = new ChangePlannerService(configuration);
  const validator = new ProjectChangePlanValidator(configuration);

  it('accepts a generated plan', () => {
    expect(() => validator.validate(planner.plan(createResponsePackage()))).not.toThrow();
  });

  it('rejects malformed structure and unsupported versions', () => {
    expect(() => validator.validate(null)).toThrow(ChangePlanValidationError);
    const plan = planner.plan(createResponsePackage());
    expect(() => validator.validate({ ...plan, schemaVersion: 2 })).toThrow(
      ChangePlanValidationError,
    );
    expect(() => validator.validate({ ...plan, unexpected: true })).toThrow(
      ChangePlanValidationError,
    );
  });

  it('rejects invalid operations, paths, checksums, metadata, and source structure', () => {
    const plan = planner.plan(createResponsePackage());
    const operation = plan.changeSet.operations[0];
    expect(operation).toBeDefined();
    if (operation === undefined) return;
    expect(() =>
      validator.validate({
        ...plan,
        source: { ...plan.source, executionId: '' },
        changeSet: {
          operations: [
            {
              ...operation,
              logicalPath: '../escape.ts',
              artifactType: 'PATCH',
              sourceChecksum: { algorithm: 'SHA 256', value: 'NOT HEX' },
            },
          ],
        },
        metadata: { Invalid_Key: { nested: true } },
      }),
    ).toThrow(ChangePlanValidationError);
  });

  it('rejects noncanonical order and summary drift', () => {
    const responsePackage = createResponsePackage();
    const plan = planner.plan(responsePackage);
    expect(() =>
      validator.validate({
        ...plan,
        summary: { ...plan.summary, totalOperations: 99 },
      }),
    ).toThrow(ChangePlanValidationError);
    expect(() =>
      validator.validate({
        ...plan,
        warnings: [...plan.warnings].reverse(),
      }),
    ).toThrow(ChangePlanValidationError);
  });

  it('rejects invalid and noncanonical operation references', () => {
    const plan = planner.plan(createResponsePackage());
    const warning = plan.warnings[0];
    expect(warning).toBeDefined();
    if (warning === undefined) return;
    expect(() =>
      validator.validate({
        ...plan,
        warnings: [...plan.warnings.slice(1), { ...warning, operationIds: ['missing-operation'] }],
      }),
    ).toThrow(ChangePlanValidationError);
  });
});
