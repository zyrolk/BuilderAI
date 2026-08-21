import type { FileApplyResult } from '../../core/file-apply';
import type { ProjectChangePlan } from '../../core/change-planner';
import type {
  OperatorVerificationFailureCategory,
  VerificationReport,
  VerificationStage,
} from '../../core/verification';

const STAGE_FAILURE_CATEGORY: Readonly<
  Partial<Record<VerificationStage, OperatorVerificationFailureCategory>>
> = {
  BUILD_VALIDATION: 'BUILD_FAILED',
  TEST_VALIDATION: 'TEST_FAILED',
  LINT_VALIDATION: 'LINT_FAILED',
  TYPECHECK_VALIDATION: 'TYPECHECK_FAILED',
};

const INFRASTRUCTURE_CODES = new Set([
  'STAGE_EXECUTION_FAILED',
  'STAGE_CONTRACT_VIOLATION',
  'DEPENDENCY_VALIDATION_FAILED',
]);

export interface VerificationOutcomeSummary {
  readonly categories: readonly OperatorVerificationFailureCategory[];
  readonly failedStages: readonly VerificationStage[];
  readonly primaryCategory: OperatorVerificationFailureCategory | undefined;
  readonly primaryLabel: string | undefined;
}

export function summarizeVerificationFailures(
  report: VerificationReport | undefined,
): VerificationOutcomeSummary {
  if (report === undefined || report.status === 'PASSED') {
    return {
      categories: [],
      failedStages: [],
      primaryCategory: undefined,
      primaryLabel: undefined,
    };
  }

  const categories = new Set<OperatorVerificationFailureCategory>();
  const failedStages: VerificationStage[] = [];

  for (const stage of report.stages) {
    if (
      stage.status !== 'FAILED' &&
      stage.status !== 'TIMEOUT' &&
      stage.status !== 'CANCELLED' &&
      stage.status !== 'POLICY_BLOCKED' &&
      stage.status !== 'OUTPUT_LIMIT_EXCEEDED' &&
      stage.status !== 'PROCESS_FAILED' &&
      stage.status !== 'UNAVAILABLE'
    ) {
      continue;
    }
    failedStages.push(stage.stage);
    for (const error of stage.errors) {
      if (error.code === 'VERIFICATION_COMMAND_TIMEOUT') {
        categories.add('VERIFICATION_COMMAND_TIMEOUT');
        continue;
      }
      if (INFRASTRUCTURE_CODES.has(error.code)) {
        categories.add('VERIFICATION_INFRASTRUCTURE_FAILURE');
        continue;
      }
      const mapped = STAGE_FAILURE_CATEGORY[stage.stage];
      if (mapped !== undefined) categories.add(mapped);
      else if (error.code.endsWith('_FAILED'))
        categories.add('VERIFICATION_INFRASTRUCTURE_FAILURE');
    }
  }

  for (const error of report.errors) {
    if (error.code === 'VERIFICATION_COMMAND_TIMEOUT')
      categories.add('VERIFICATION_COMMAND_TIMEOUT');
    if (INFRASTRUCTURE_CODES.has(error.code)) {
      categories.add('VERIFICATION_INFRASTRUCTURE_FAILURE');
    }
  }

  const ordered = [...categories];
  const primaryCategory = ordered[0];
  return {
    categories: ordered,
    failedStages,
    primaryCategory,
    primaryLabel:
      primaryCategory === undefined ? undefined : formatFailureCategory(primaryCategory),
  };
}

export function formatFailureCategory(category: OperatorVerificationFailureCategory): string {
  return category
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function hasAppliedChanges(applyResult: FileApplyResult | undefined): boolean {
  if (applyResult === undefined) return false;
  return (
    applyResult.createdFiles.length > 0 ||
    applyResult.updatedFiles.length > 0 ||
    applyResult.deletedFiles.length > 0
  );
}

export function isAppliedWithVerificationFailure(
  applyResult: FileApplyResult | undefined,
  verificationReport: VerificationReport | undefined,
): boolean {
  return (
    applyResult?.status === 'APPLIED' &&
    verificationReport !== undefined &&
    (verificationReport.status === 'FAILED' || verificationReport.status === 'PARTIALLY_PASSED')
  );
}

export function isPartialApplyOutcome(applyResult: FileApplyResult | undefined): boolean {
  return applyResult?.status === 'PARTIALLY_APPLIED';
}

export function hasBaselineDriftApplyFailure(applyResult: FileApplyResult | undefined): boolean {
  return applyResult?.errors.some(({ code }) => code === 'BASELINE_CONTENT_DRIFT') ?? false;
}

export function changePlanTouchesPackageJson(changePlan: ProjectChangePlan | undefined): boolean {
  if (changePlan === undefined) return false;
  return changePlan.changeSet.operations.some(
    ({ logicalPath }) => logicalPath === 'package.json' || logicalPath.endsWith('/package.json'),
  );
}

export function changePlanTouchesLockfile(changePlan: ProjectChangePlan | undefined): boolean {
  if (changePlan === undefined) return false;
  return changePlan.changeSet.operations.some(({ logicalPath }) =>
    ['package-lock.json', 'npm-shrinkwrap.json'].includes(logicalPath),
  );
}
