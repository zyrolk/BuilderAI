import { ChangePlannerService } from '../services';
import { ChangePlanValidationError } from '../types';
import { ChangePlanReferenceValidator } from '../validators';
import { createConfiguration, createResponsePackage } from './change-planner.fixture';

describe('ChangePlanReferenceValidator', () => {
  const configuration = createConfiguration();
  const planner = new ChangePlannerService(configuration);
  const validator = new ChangePlanReferenceValidator();

  it('accepts plan references that match the source package', () => {
    const responsePackage = createResponsePackage();
    expect(() => validator.validate(planner.plan(responsePackage), responsePackage)).not.toThrow();
  });

  it('rejects source identity and metadata drift', () => {
    const responsePackage = createResponsePackage();
    const plan = planner.plan(responsePackage);
    expect(() =>
      validator.validate(
        {
          ...plan,
          source: { ...plan.source, executionId: 'other-execution' },
          metadata: { ...plan.metadata, 'provider-id': 'other-provider' },
        },
        responsePackage,
      ),
    ).toThrow(ChangePlanValidationError);
  });

  it('rejects artifact content, manifest, and operation intent drift', () => {
    const responsePackage = createResponsePackage();
    const plan = planner.plan(responsePackage);
    const operation = plan.changeSet.operations[0];
    expect(operation).toBeDefined();
    if (operation === undefined || operation.kind === 'DELETE_FILE') return;
    const changedPlan = {
      ...plan,
      changeSet: {
        operations: [{ ...operation, content: `${operation.content}changed` }],
      },
      summary: plan.summary,
    };
    expect(() => validator.validate(changedPlan, responsePackage)).toThrow(
      ChangePlanValidationError,
    );
  });

  it('translates invalid Response Package structure into plan-reference errors', () => {
    const responsePackage = createResponsePackage();
    const plan = planner.plan(responsePackage);
    expect(() => validator.validate(plan, { ...responsePackage, schemaVersion: 2 })).toThrow(
      ChangePlanValidationError,
    );
  });
});
