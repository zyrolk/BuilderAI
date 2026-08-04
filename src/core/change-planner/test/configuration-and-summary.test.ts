import { DEFAULT_CHANGE_PLANNER_CONFIGURATION } from '../config';
import { ChangePlanSummaryService, ChangePlannerService, ChangeRiskService } from '../services';
import { ChangePlanValidationError } from '../types';
import { ChangePlannerConfigurationValidator } from '../validators';
import {
  createArtifact,
  createConfiguration,
  createResponsePackage,
} from './change-planner.fixture';

describe('change planner configuration, summary, and risk policy', () => {
  const validator = new ChangePlannerConfigurationValidator();

  it('accepts default and custom configuration', () => {
    expect(() => validator.validate(DEFAULT_CHANGE_PLANNER_CONFIGURATION)).not.toThrow();
    expect(() => validator.validate(createConfiguration())).not.toThrow();
  });

  it.each([
    null,
    { ...createConfiguration(), maximumOperations: 0 },
    { ...createConfiguration(), maximumMetadataEntries: Number.NaN },
    { ...createConfiguration(), broadChangeOperationThreshold: 11 },
    {
      ...createConfiguration(),
      preservation: {
        ...createConfiguration().preservation,
        highChurnThreshold: 0.2,
        elevatedChurnThreshold: 0.5,
      },
    },
    { ...createConfiguration(), unknown: true },
  ])('rejects invalid configuration %#', (configuration: unknown) => {
    expect(() => validator.validate(configuration)).toThrow(ChangePlanValidationError);
  });

  it('generates deterministic summaries and policy findings', () => {
    const configuration = createConfiguration({ broadChangeOperationThreshold: 1 });
    const plan = new ChangePlannerService(configuration).plan(
      createResponsePackage([
        createArtifact({
          logicalPath: 'config/old.json',
          type: 'CONFIGURATION',
          content: '',
          metadata: { 'change-operation': 'DELETE_FILE', description: 'Delete configuration' },
        }),
      ]),
    );
    const summary = new ChangePlanSummaryService().generate(
      plan.changeSet.operations,
      plan.warnings,
    );
    expect(summary).toEqual(plan.summary);
    expect(new ChangeRiskService(configuration).evaluate(plan.changeSet.operations)).toEqual(
      plan.risks,
    );
    expect(plan.risks.map(({ severity }) => severity)).toEqual(['MEDIUM', 'MEDIUM', 'HIGH']);
  });
});
