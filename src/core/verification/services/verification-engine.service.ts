import {
  FileApplyResultValidator,
  isVerificationEligibleFileApplyResult,
  type FileApplyResult,
} from '../../file-apply';
import type { ExecutionCancellationToken } from '../../execution-engine';
import type { VerificationConfiguration } from '../config';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../config';
import type { VerificationClockPort, VerificationPorts } from '../ports';
import {
  VERIFICATION_REPORT_SCHEMA_VERSION,
  VERIFICATION_STAGE_FAILURE_OUTCOMES,
  VERIFICATION_STAGE_SUCCESS_OUTCOMES,
  type VerificationContext,
  type VerificationReport,
  type VerificationStage,
  type VerificationStagePortResult,
  type VerificationStageResult,
  type VerificationStageStatus,
  VerificationValidationError,
} from '../types';
import {
  VerificationConfigurationValidator,
  VerificationReportValidator,
  VerificationStagePortResultValidator,
} from '../validators';
import { deriveStatus, flatten } from '../validators/verification-report.validator';
import {
  normalizeDiagnostic,
  normalizeMessages,
  normalizeMetadata,
} from '../validators/validation-helpers';
import { SystemVerificationClockService } from './system-verification-clock.service';

export interface VerificationEngineOptions {
  readonly cancellation?: ExecutionCancellationToken;
}

export class VerificationEngineService {
  private readonly applyResultValidator: FileApplyResultValidator = new FileApplyResultValidator();
  private readonly stageResultValidator: VerificationStagePortResultValidator;
  private readonly reportValidator: VerificationReportValidator;

  constructor(
    private readonly ports: VerificationPorts,
    private readonly configuration: VerificationConfiguration = DEFAULT_VERIFICATION_CONFIGURATION,
    private readonly clock: VerificationClockPort = new SystemVerificationClockService(),
  ) {
    const configurationValidator: VerificationConfigurationValidator =
      new VerificationConfigurationValidator();
    configurationValidator.validate(configuration);
    this.stageResultValidator = new VerificationStagePortResultValidator(configuration);
    this.reportValidator = new VerificationReportValidator(configuration);
  }

  async verify(
    value: unknown,
    options: VerificationEngineOptions = {},
  ): Promise<VerificationReport> {
    const applyResult = this.acceptSuccessfulApplyResult(value);
    const context = this.createContext(applyResult);
    const startedAt = this.clock.now();
    const workflowDeadlineAt = startedAt + this.configuration.workflowDeadlineMs;
    const stages: VerificationStageResult[] = [];
    for (const stage of this.configuration.pipeline) {
      const remainingWorkflowMs = workflowDeadlineAt - this.clock.now();
      if (remainingWorkflowMs <= 0 || options.cancellation?.cancelled) {
        stages.push(
          createUnavailableStageResult(stage, startedAt, options.cancellation?.cancelled),
        );
        continue;
      }
      stages.push(
        await this.runStage(stage, context, {
          remainingWorkflowMs,
          cancellation: options.cancellation,
        }),
      );
    }
    const report: VerificationReport = {
      schemaVersion: VERIFICATION_REPORT_SCHEMA_VERSION,
      status: deriveStatus(stages),
      stages,
      warnings: flatten(stages, 'warnings'),
      errors: flatten(stages, 'errors'),
      durationMs: duration(startedAt, this.clock.now()),
      metadata: normalizeMetadata(applyResult.metadata),
    };
    this.reportValidator.validate(report);
    return report;
  }

  private acceptSuccessfulApplyResult(value: unknown): FileApplyResult {
    try {
      this.applyResultValidator.validate(value);
    } catch {
      throw new VerificationValidationError([
        {
          code: 'INVALID_APPLY_RESULT',
          path: '$',
          message: 'must be a valid File Apply Result',
        },
      ]);
    }
    if (!isVerificationEligibleFileApplyResult(value)) {
      throw new VerificationValidationError([
        {
          code: 'INVALID_APPLY_RESULT',
          path: '$.status',
          message: 'must equal APPLIED or PARTIALLY_APPLIED',
        },
      ]);
    }
    return value;
  }

  private createContext(fileApplyResult: FileApplyResult): VerificationContext {
    const cloned = structuredClone(fileApplyResult);
    return {
      fileApplyResult: cloned,
      affectedFiles: {
        created: [...cloned.createdFiles],
        updated: [...cloned.updatedFiles],
        deleted: [...cloned.deletedFiles],
      },
      metadata: normalizeMetadata(cloned.metadata),
    };
  }

  private async runStage(
    stage: VerificationStage,
    context: VerificationContext,
    options: {
      readonly remainingWorkflowMs: number;
      readonly cancellation?: ExecutionCancellationToken;
    },
  ): Promise<VerificationStageResult> {
    const startedAt = this.clock.now();
    try {
      const result = await this.invoke(stage, structuredClone(context), options);
      this.stageResultValidator.validate(result);
      return this.toStageResult(stage, result, startedAt);
    } catch (error: unknown) {
      const contractViolation = error instanceof VerificationValidationError;
      return {
        stage,
        status: 'FAILED',
        warnings: [],
        errors: [
          {
            code: contractViolation ? 'STAGE_CONTRACT_VIOLATION' : 'STAGE_EXECUTION_FAILED',
            message: contractViolation
              ? 'The verification port returned an invalid result.'
              : 'The verification port failed to complete.',
          },
        ],
        durationMs: duration(startedAt, this.clock.now()),
        metadata: {},
      };
    }
  }

  private invoke(
    stage: VerificationStage,
    context: VerificationContext,
    options: {
      readonly remainingWorkflowMs: number;
      readonly cancellation?: ExecutionCancellationToken;
    },
  ): Promise<VerificationStagePortResult> {
    const enrichedContext: VerificationContext = {
      ...context,
      execution: {
        remainingWorkflowMs: options.remainingWorkflowMs,
        cancellation: options.cancellation,
      },
    };
    switch (stage) {
      case 'PROJECT_VALIDATION':
        return this.ports.projectValidator.validateProject(enrichedContext);
      case 'DEPENDENCY_VALIDATION':
        return this.ports.dependencyValidator.validateDependencies(enrichedContext);
      case 'BUILD_VALIDATION':
        return this.ports.buildRunner.runBuild(enrichedContext);
      case 'TEST_VALIDATION':
        return this.ports.testRunner.runTests(enrichedContext);
      case 'LINT_VALIDATION':
        return this.ports.lintRunner.runLint(enrichedContext);
      case 'TYPECHECK_VALIDATION':
        return this.ports.typecheckRunner.runTypecheck(enrichedContext);
      case 'FORMAT_VALIDATION':
        return this.ports.formatRunner.runFormat(enrichedContext);
    }
  }

  private toStageResult(
    stage: VerificationStage,
    result: VerificationStagePortResult,
    startedAt: number,
  ): VerificationStageResult {
    return {
      stage,
      status: result.status,
      warnings: normalizeMessages(result.warnings),
      errors: normalizeMessages(result.errors),
      durationMs: duration(startedAt, this.clock.now()),
      metadata: normalizeMetadata(result.metadata),
      ...(normalizeDiagnostic(result.diagnostic) === undefined
        ? {}
        : { diagnostic: normalizeDiagnostic(result.diagnostic) }),
    };
  }
}

function createUnavailableStageResult(
  stage: VerificationStage,
  startedAt: number,
  cancelled?: boolean,
): VerificationStageResult {
  return {
    stage,
    status: cancelled ? 'CANCELLED' : 'UNAVAILABLE',
    warnings: [],
    errors: [
      {
        code: cancelled ? 'VERIFICATION_CANCELLED' : 'VERIFICATION_WORKFLOW_DEADLINE_EXCEEDED',
        message: cancelled
          ? 'Verification was cancelled before this stage could start.'
          : 'Verification workflow deadline expired before this stage could start.',
      },
    ],
    durationMs: 0,
    metadata: { 'skipped-due-to-deadline': true },
  };
}

function duration(startedAt: number, finishedAt: number): number {
  const elapsed = finishedAt - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0;
}

export function isVerificationStageFailure(status: VerificationStageStatus): boolean {
  return (VERIFICATION_STAGE_FAILURE_OUTCOMES as readonly string[]).includes(status);
}

export function isVerificationStageSuccess(status: VerificationStageStatus): boolean {
  return (VERIFICATION_STAGE_SUCCESS_OUTCOMES as readonly string[]).includes(status);
}
