import type {
  VerificationCommandDescriptor,
  VerificationCommandDescriptorId,
} from '../../core/verification/policy';
import type {
  VerificationMessage,
  VerificationStagePortResult,
  VerificationStageStatus,
} from '../../core/verification';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../../core/verification';
import { buildVerificationDiagnostic } from './verification-diagnostic';
import type { SafeVerificationExecutionResult } from './safe-verification-runner';

export interface StageFailureMapping {
  readonly failureCode: string;
  readonly message: string;
}

export interface MapExecutionToStageResultInput {
  readonly descriptor: VerificationCommandDescriptor;
  readonly execution: SafeVerificationExecutionResult;
  readonly failure: StageFailureMapping;
  readonly diagnosticLimits?: {
    readonly maximumStdoutCharacters: number;
    readonly maximumStderrCharacters: number;
    readonly maximumCombinedCharacters: number;
  };
}

export function mapExecutionToStageResult(
  input: MapExecutionToStageResultInput,
): VerificationStagePortResult {
  const limits = input.diagnosticLimits ?? {
    maximumStdoutCharacters: DEFAULT_VERIFICATION_CONFIGURATION.maximumDiagnosticStdoutCharacters,
    maximumStderrCharacters: DEFAULT_VERIFICATION_CONFIGURATION.maximumDiagnosticStderrCharacters,
    maximumCombinedCharacters:
      DEFAULT_VERIFICATION_CONFIGURATION.maximumDiagnosticCombinedCharacters,
  };
  const status = deriveStageStatus(input.execution);
  const warnings: VerificationMessage[] = [];
  const errors: VerificationMessage[] = [];
  if (status === 'SKIPPED') {
    return skippedStageResult('unknown');
  }
  if (input.execution.policyBlocked) {
    errors.push({
      code: input.execution.policyBlockCode ?? 'VERIFICATION_POLICY_BLOCKED',
      message: input.failure.message,
    });
  } else if (input.execution.cancelled) {
    errors.push({
      code: 'VERIFICATION_CANCELLED',
      message: `${input.descriptor.stage} was cancelled.`,
    });
  } else if (input.execution.timedOut) {
    errors.push({
      code: 'VERIFICATION_COMMAND_TIMEOUT',
      message: `${input.descriptor.stage} exceeded its time limit.`,
    });
  } else if (status === 'OUTPUT_LIMIT_EXCEEDED') {
    errors.push({
      code: 'VERIFICATION_OUTPUT_LIMIT_EXCEEDED',
      message: `${input.descriptor.stage} output exceeded configured limits.`,
    });
  } else if (status === 'PROCESS_FAILED') {
    errors.push({
      code: 'VERIFICATION_PROCESS_FAILED',
      message: `${input.descriptor.stage} terminated abnormally.`,
    });
  } else if (status === 'FAILED') {
    errors.push({
      code: input.failure.failureCode,
      message: input.failure.message,
    });
  }
  if (input.execution.outputLimited && status !== 'OUTPUT_LIMIT_EXCEEDED') {
    warnings.push({
      code: 'OUTPUT_TRUNCATED',
      message: `${input.descriptor.stage} diagnostic output was truncated.`,
    });
  }
  const diagnostic = shouldIncludeDiagnostic(status)
    ? buildVerificationDiagnostic({
        commandDescriptorId: input.descriptor.id,
        exitCode: input.execution.exitCode,
        timedOut: input.execution.timedOut,
        cancelled: input.execution.cancelled,
        outputLimited: input.execution.outputLimited,
        policyBlocked: input.execution.policyBlocked,
        stdout: input.execution.stdout,
        stderr: input.execution.stderr,
        outputBytes:
          Buffer.byteLength(input.execution.stdout, 'utf8') +
          Buffer.byteLength(input.execution.stderr, 'utf8'),
        outputTruncated: input.execution.outputLimited,
        limits: {
          maximumStdoutCharacters: limits.maximumStdoutCharacters,
          maximumStderrCharacters: limits.maximumStderrCharacters,
          maximumCombinedCharacters: limits.maximumCombinedCharacters,
        },
      })
    : undefined;
  return {
    status,
    warnings,
    errors,
    metadata: {
      'command-descriptor-id': input.descriptor.id,
      'exit-code': input.execution.exitCode ?? -1,
      ...(input.execution.signal === null ? {} : { signal: input.execution.signal }),
      timedOut: input.execution.timedOut,
      cancelled: input.execution.cancelled,
      outputLimited: input.execution.outputLimited,
      policyBlocked: input.execution.policyBlocked,
    },
    ...(diagnostic === undefined ? {} : { diagnostic }),
  };
}

export function skippedStageResult(scriptKind: string): VerificationStagePortResult {
  return {
    status: 'SKIPPED',
    warnings: [
      {
        code: 'STAGE_SKIPPED',
        message: `No ${scriptKind} script declared in package.json; ${scriptKind} validation was skipped.`,
      },
    ],
    errors: [],
    metadata: { skipped: true, 'script-kind': scriptKind },
  };
}

function deriveStageStatus(execution: SafeVerificationExecutionResult): VerificationStageStatus {
  if (execution.policyBlocked) {
    if (execution.policyBlockCode === 'WORKFLOW_DEADLINE_EXCEEDED') return 'UNAVAILABLE';
    return 'POLICY_BLOCKED';
  }
  if (execution.cancelled) return 'CANCELLED';
  if (execution.timedOut) return 'TIMEOUT';
  if (execution.outputLimited && execution.exitCode !== 0) return 'OUTPUT_LIMIT_EXCEEDED';
  if (execution.signal !== null) return 'PROCESS_FAILED';
  if (execution.exitCode === 0) return 'PASSED';
  if (execution.exitCode === null) return 'PROCESS_FAILED';
  if (execution.outputLimited) return 'OUTPUT_LIMIT_EXCEEDED';
  return 'FAILED';
}

function shouldIncludeDiagnostic(status: VerificationStageStatus): boolean {
  return status !== 'PASSED' && status !== 'SKIPPED';
}

export function descriptorIdForScript(
  scriptKind: 'lint' | 'typecheck' | 'format',
): Extract<
  VerificationCommandDescriptorId,
  'npm-run-lint' | 'npm-run-typecheck' | 'npm-run-format'
> {
  if (scriptKind === 'lint') return 'npm-run-lint';
  if (scriptKind === 'typecheck') return 'npm-run-typecheck';
  return 'npm-run-format';
}
