import type { FileApplyResult } from '../../file-apply';
import type {
  VerificationClockPort,
  VerificationContext,
  VerificationPorts,
  VerificationStage,
  VerificationStagePortResult,
} from '..';

export const PASSED_STAGE_RESULT: VerificationStagePortResult = {
  status: 'PASSED',
  warnings: [],
  errors: [],
  metadata: {},
};

export function createAppliedResult(overrides: Partial<FileApplyResult> = {}): FileApplyResult {
  return {
    schemaVersion: 1,
    status: 'APPLIED',
    createdFiles: ['src/new.ts'],
    updatedFiles: ['src/existing.ts'],
    deletedFiles: ['src/obsolete.ts'],
    skippedFiles: [],
    warnings: [],
    errors: [],
    durationMs: 12,
    metadata: { 'change-id': 'change-11', sprint: 11 },
    ...overrides,
  };
}

export class SequenceClock implements VerificationClockPort {
  private index = 0;

  constructor(private readonly values: readonly number[]) {}

  now(): number {
    const value = this.values[this.index];
    this.index += 1;
    if (value === undefined) throw new Error('Clock sequence exhausted');
    return value;
  }
}

export interface PortHarness {
  readonly ports: VerificationPorts;
  readonly calls: VerificationStage[];
  readonly contexts: VerificationContext[];
}

export function createPortHarness(
  results: Partial<Readonly<Record<VerificationStage, unknown>>> = {},
): PortHarness {
  const calls: VerificationStage[] = [];
  const contexts: VerificationContext[] = [];

  async function invoke(
    stage: VerificationStage,
    context: VerificationContext,
  ): Promise<VerificationStagePortResult> {
    calls.push(stage);
    contexts.push(context);
    const configured = results[stage] ?? PASSED_STAGE_RESULT;
    if (configured instanceof Error) throw configured;
    return configured as VerificationStagePortResult;
  }

  return {
    calls,
    contexts,
    ports: {
      projectValidator: {
        validateProject: (context) => invoke('PROJECT_VALIDATION', context),
      },
      dependencyValidator: {
        validateDependencies: (context) => invoke('DEPENDENCY_VALIDATION', context),
      },
      buildRunner: { runBuild: (context) => invoke('BUILD_VALIDATION', context) },
      testRunner: { runTests: (context) => invoke('TEST_VALIDATION', context) },
      lintRunner: { runLint: (context) => invoke('LINT_VALIDATION', context) },
      typecheckRunner: { runTypecheck: (context) => invoke('TYPECHECK_VALIDATION', context) },
      formatRunner: { runFormat: (context) => invoke('FORMAT_VALIDATION', context) },
    },
  };
}

export function createDeterministicClock(): SequenceClock {
  return new SequenceClock([
    0, 1, 3, 4, 7, 8, 13, 14, 20, 21, 25, 26, 30, 31, 35, 36, 40, 41, 45, 46, 50, 51, 55, 56, 60,
    61, 65, 66, 70, 71, 75, 76, 80, 81, 85, 86, 90, 91, 95, 96, 100,
  ]);
}
