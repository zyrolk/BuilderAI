import type { ExecutionCancellationToken } from '../../../core/execution-engine';
import type { VerificationCommandDescriptor } from '../../../core/verification/policy';
import {
  createBuildDescriptor,
  createDependencyValidationDescriptor,
  createNamedScriptDescriptor,
  createTestDescriptor,
  VerificationPolicyViolationError,
  type VerificationExecutionPolicyConfiguration,
} from '../../../core/verification/policy';
import { digestStructured } from '../../../core/workflow-ledger/services/workflow-digest.service';
import {
  discoverPackageScripts,
  type DiscoveredPackageScripts,
} from '../../../infrastructure/verification/package-script-discovery';
import type { SafeVerificationExecutionResult } from '../../../infrastructure/verification/safe-verification-runner';
import { redactVerificationOutput } from '../../../infrastructure/verification/verification-output-sanitize';
import {
  CONTROLLED_TERMINAL_COMMAND_IDS,
  isControlledTerminalCommandId,
  type ControlledTerminalCatalogEntry,
  type ControlledTerminalCommandId,
  type ControlledTerminalExecutionStatus,
  type ControlledTerminalRunResult,
} from './controlled-terminal.types';

/** Narrow runner port — production wraps SafeVerificationRunner; tests inject fakes. */
export interface ControlledTerminalRunnerPort {
  execute(
    descriptor: VerificationCommandDescriptor,
    options?: {
      readonly cancellation?: ExecutionCancellationToken;
      readonly remainingWorkflowMs?: number;
    },
  ): Promise<SafeVerificationExecutionResult>;
}

export interface ControlledTerminalServiceDeps {
  readonly createRunner: (projectRoot: string) => ControlledTerminalRunnerPort;
  readonly discoverScripts?: (projectRoot: string) => DiscoveredPackageScripts;
  readonly stageTimeoutMs?: number;
  readonly outputLimitBytes?: number;
  readonly diagnosticSummaryMaxChars?: number;
}

const DEFAULT_STAGE_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT_BYTES = 1_000_000;
const DEFAULT_DIAGNOSTIC_SUMMARY_MAX_CHARS = 1_024;

/**
 * Catalog-only controlled terminal (ADR-040).
 * Maps command ids → existing verification descriptors → SafeVerificationRunner.
 * Does not expose shell, free-form argv, FileApply, or approveAndApply.
 */
export class ControlledTerminalService {
  private readonly discoverScripts: (projectRoot: string) => DiscoveredPackageScripts;
  private readonly stageTimeoutMs: number;
  private readonly outputLimitBytes: number;
  private readonly diagnosticSummaryMaxChars: number;

  constructor(private readonly deps: ControlledTerminalServiceDeps) {
    this.discoverScripts = deps.discoverScripts ?? discoverPackageScripts;
    this.stageTimeoutMs = deps.stageTimeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;
    this.outputLimitBytes = deps.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
    this.diagnosticSummaryMaxChars =
      deps.diagnosticSummaryMaxChars ?? DEFAULT_DIAGNOSTIC_SUMMARY_MAX_CHARS;
  }

  listCatalog(projectRoot: string): readonly ControlledTerminalCatalogEntry[] {
    const scripts = this.discoverScripts(projectRoot);
    return CONTROLLED_TERMINAL_COMMAND_IDS.map((commandId) =>
      describeCatalogEntry(commandId, scripts),
    );
  }

  async runCommand(input: {
    readonly commandId: unknown;
    readonly projectRoot: string;
    readonly cancellation?: ExecutionCancellationToken;
    readonly remainingWorkflowMs?: number;
  }): Promise<ControlledTerminalRunResult> {
    if (!isControlledTerminalCommandId(input.commandId)) {
      return policyRejectedResult(
        typeof input.commandId === 'string' ? input.commandId : 'unknown',
        'UNKNOWN_COMMAND_ID',
        'Command id is not in the controlled terminal catalog.',
      );
    }

    const projectRoot = input.projectRoot.trim();
    if (projectRoot.length === 0) {
      return policyRejectedResult(
        input.commandId,
        'INVALID_PROJECT_ROOT',
        'projectRoot is required.',
      );
    }

    if (input.cancellation?.cancelled) {
      return cancelledRunResult(input.commandId);
    }

    const scripts = this.discoverScripts(projectRoot);
    const resolved = resolveDescriptor(input.commandId, scripts, {
      projectRoot,
      stageTimeoutMs: this.stageTimeoutMs,
      outputLimitBytes: this.outputLimitBytes,
    });
    if (!resolved.ok) {
      return policyRejectedResult(input.commandId, resolved.code, resolved.message);
    }

    const runnerResult = createRunnerSafely(this.deps.createRunner, projectRoot);
    if (!runnerResult.ok) {
      return policyRejectedResult(input.commandId, runnerResult.code, runnerResult.message);
    }

    const execution = await runnerResult.runner.execute(resolved.descriptor, {
      cancellation: input.cancellation,
      remainingWorkflowMs: input.remainingWorkflowMs,
    });

    return mapExecutionToResult({
      commandId: input.commandId,
      stage: resolved.descriptor.stage,
      execution,
      diagnosticSummaryMaxChars: this.diagnosticSummaryMaxChars,
    });
  }
}

function createRunnerSafely(
  createRunner: (projectRoot: string) => ControlledTerminalRunnerPort,
  projectRoot: string,
):
  | { readonly ok: true; readonly runner: ControlledTerminalRunnerPort }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  try {
    return { ok: true, runner: createRunner(projectRoot) };
  } catch (error: unknown) {
    if (error instanceof VerificationPolicyViolationError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

function describeCatalogEntry(
  commandId: ControlledTerminalCommandId,
  scripts: DiscoveredPackageScripts,
): ControlledTerminalCatalogEntry {
  switch (commandId) {
    case 'npm-ls-omit-dev-json':
      return {
        commandId,
        available: true,
        stage: 'DEPENDENCY_VALIDATION',
        description: 'npm ls --omit=dev --json --depth=0',
      };
    case 'npm-run-build':
      return {
        commandId,
        available: scripts.hasBuild,
        scriptName: scripts.hasBuild ? 'build' : undefined,
        stage: 'BUILD_VALIDATION',
        description: 'npm run build',
      };
    case 'npm-run-test':
      return {
        commandId,
        available: scripts.hasTest,
        scriptName: scripts.hasTest ? 'test' : undefined,
        stage: 'TEST_VALIDATION',
        description: 'npm test',
      };
    case 'npm-run-lint':
      return {
        commandId,
        available: scripts.lintScript !== undefined,
        scriptName: scripts.lintScript,
        stage: 'LINT_VALIDATION',
        description: 'npm run lint (allowlisted script name)',
      };
    case 'npm-run-typecheck':
      return {
        commandId,
        available: scripts.typecheckScript !== undefined,
        scriptName: scripts.typecheckScript,
        stage: 'TYPECHECK_VALIDATION',
        description: 'npm run typecheck|type-check',
      };
    case 'npm-run-format':
      return {
        commandId,
        available: scripts.formatScript !== undefined,
        scriptName: scripts.formatScript,
        stage: 'FORMAT_VALIDATION',
        description: 'npm run format:check|format-check',
      };
  }
}

function resolveDescriptor(
  commandId: ControlledTerminalCommandId,
  scripts: DiscoveredPackageScripts,
  configuration: VerificationExecutionPolicyConfiguration,
):
  | { readonly ok: true; readonly descriptor: VerificationCommandDescriptor }
  | { readonly ok: false; readonly code: string; readonly message: string } {
  switch (commandId) {
    case 'npm-ls-omit-dev-json':
      return { ok: true, descriptor: createDependencyValidationDescriptor(configuration) };
    case 'npm-run-build':
      if (!scripts.hasBuild) {
        return {
          ok: false,
          code: 'SCRIPT_UNAVAILABLE',
          message: 'package.json does not declare an allowlisted build script.',
        };
      }
      return { ok: true, descriptor: createBuildDescriptor(configuration) };
    case 'npm-run-test':
      if (!scripts.hasTest) {
        return {
          ok: false,
          code: 'SCRIPT_UNAVAILABLE',
          message: 'package.json does not declare an allowlisted test script.',
        };
      }
      return { ok: true, descriptor: createTestDescriptor(configuration) };
    case 'npm-run-lint':
      if (scripts.lintScript === undefined) {
        return {
          ok: false,
          code: 'SCRIPT_UNAVAILABLE',
          message: 'package.json does not declare an allowlisted lint script.',
        };
      }
      return {
        ok: true,
        descriptor: createNamedScriptDescriptor(configuration, {
          id: 'npm-run-lint',
          stage: 'LINT_VALIDATION',
          scriptName: scripts.lintScript,
        }),
      };
    case 'npm-run-typecheck':
      if (scripts.typecheckScript === undefined) {
        return {
          ok: false,
          code: 'SCRIPT_UNAVAILABLE',
          message: 'package.json does not declare an allowlisted typecheck script.',
        };
      }
      return {
        ok: true,
        descriptor: createNamedScriptDescriptor(configuration, {
          id: 'npm-run-typecheck',
          stage: 'TYPECHECK_VALIDATION',
          scriptName: scripts.typecheckScript,
        }),
      };
    case 'npm-run-format':
      if (scripts.formatScript === undefined) {
        return {
          ok: false,
          code: 'SCRIPT_UNAVAILABLE',
          message: 'package.json does not declare an allowlisted format-check script.',
        };
      }
      return {
        ok: true,
        descriptor: createNamedScriptDescriptor(configuration, {
          id: 'npm-run-format',
          stage: 'FORMAT_VALIDATION',
          scriptName: scripts.formatScript,
        }),
      };
  }
}

function mapExecutionToResult(input: {
  readonly commandId: ControlledTerminalCommandId;
  readonly stage: string;
  readonly execution: SafeVerificationExecutionResult;
  readonly diagnosticSummaryMaxChars: number;
}): ControlledTerminalRunResult {
  const { execution } = input;
  const executionStatus = deriveExecutionStatus(execution);
  const diagnosticSummary = buildDiagnosticSummary(
    execution.stdout,
    execution.stderr,
    input.diagnosticSummaryMaxChars,
  );
  const outputDigest = digestStructured({
    commandId: input.commandId,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    cancelled: execution.cancelled,
    policyBlocked: execution.policyBlocked,
    policyBlockCode: execution.policyBlockCode ?? null,
    stdoutDigest: digestStructured(execution.stdout),
    stderrDigest: digestStructured(execution.stderr),
  });

  return {
    commandId: input.commandId,
    stage: input.stage,
    executionStatus,
    exitCode: execution.exitCode,
    timedOut: execution.timedOut,
    cancelled: execution.cancelled,
    policyBlocked: execution.policyBlocked,
    ...(execution.policyBlockCode !== undefined
      ? { policyBlockCode: execution.policyBlockCode }
      : {}),
    outputDigest,
    diagnosticSummary,
    outputLimited: execution.outputLimited,
    networkPolicy: 'disabled-unsupported',
  };
}

function deriveExecutionStatus(
  execution: SafeVerificationExecutionResult,
): ControlledTerminalExecutionStatus {
  if (execution.policyBlocked) return 'REJECTED_BY_POLICY';
  if (execution.cancelled) return 'CANCELLED';
  if (execution.timedOut) return 'TIMEOUT';
  if (execution.exitCode === 0) return 'SUCCEEDED';
  return 'FAILED';
}

function buildDiagnosticSummary(stdout: string, stderr: string, maxChars: number): string {
  const combined = [redactVerificationOutput(stdout), redactVerificationOutput(stderr)]
    .filter((part) => part.length > 0)
    .join('\n---\n');
  if (combined.length <= maxChars) return combined;
  if (maxChars <= 1) return '…';
  return `${combined.slice(0, maxChars - 1)}…`;
}

function policyRejectedResult(
  commandId: string,
  policyBlockCode: string,
  message: string,
): ControlledTerminalRunResult {
  return {
    commandId,
    stage: 'UNKNOWN',
    executionStatus: 'REJECTED_BY_POLICY',
    exitCode: null,
    timedOut: false,
    cancelled: false,
    policyBlocked: true,
    policyBlockCode,
    outputDigest: digestStructured({ policyBlockCode, message }),
    diagnosticSummary: message.slice(0, DEFAULT_DIAGNOSTIC_SUMMARY_MAX_CHARS),
    outputLimited: false,
    networkPolicy: 'disabled-unsupported',
  };
}

function cancelledRunResult(commandId: ControlledTerminalCommandId): ControlledTerminalRunResult {
  return {
    commandId,
    stage: 'UNKNOWN',
    executionStatus: 'CANCELLED',
    exitCode: null,
    timedOut: false,
    cancelled: true,
    policyBlocked: false,
    outputDigest: digestStructured({ commandId, cancelled: true }),
    diagnosticSummary: 'Cancelled before spawn.',
    outputLimited: false,
    networkPolicy: 'disabled-unsupported',
  };
}
