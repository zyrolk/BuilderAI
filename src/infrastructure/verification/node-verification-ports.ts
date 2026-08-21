import path from 'node:path';

import type { ExecutionCancellationToken } from '../../core/execution-engine';
import type { ProjectContextReaderPort } from '../../core/target-project';
import type {
  BuildRunnerPort,
  DependencyValidatorPort,
  FormatRunnerPort,
  LintRunnerPort,
  ProjectValidatorPort,
  TestRunnerPort,
  TypecheckRunnerPort,
  VerificationContext,
  VerificationMessage,
  VerificationStagePortResult,
} from '../../core/verification';
import { DEFAULT_VERIFICATION_CONFIGURATION } from '../../core/verification';
import {
  createBuildDescriptor,
  createDependencyValidationDescriptor,
  createNamedScriptDescriptor,
  createTestDescriptor,
} from '../../core/verification/policy';
import { discoverPackageScripts, type DiscoveredPackageScripts } from './package-script-discovery';
import { SafeVerificationRunner } from './safe-verification-runner';
import {
  descriptorIdForScript,
  mapExecutionToStageResult,
  skippedStageResult,
} from './verification-stage-result';

export interface NodeVerificationConfiguration {
  readonly projectRoot: string;
  readonly builderAiRoot?: string;
  readonly commandTimeoutMs: number;
  readonly maximumOutputBytes: number;
  readonly maximumDiagnosticStdoutCharacters?: number;
  readonly maximumDiagnosticStderrCharacters?: number;
  readonly maximumDiagnosticCombinedCharacters?: number;
}

export interface NodeVerificationExecutionContext {
  readonly cancellation?: ExecutionCancellationToken;
  readonly remainingWorkflowMs?: number;
}

export class NodeProjectValidator implements ProjectValidatorPort {
  constructor(private readonly reader: ProjectContextReaderPort) {}

  async validateProject(context: VerificationContext): Promise<VerificationStagePortResult> {
    void context;
    const result = await this.reader.read();
    const errors = result.diagnostics.filter(({ severity }) => severity === 'ERROR').map(toMessage);
    const warnings = result.diagnostics
      .filter(({ severity }) => severity === 'WARNING')
      .map(toMessage);
    return {
      status: result.valid && errors.length === 0 ? 'PASSED' : 'FAILED',
      warnings,
      errors,
      metadata: {
        'document-count': result.discovery.documents.length,
        'diagnostic-count': result.diagnostics.length,
      },
    };
  }
}

export class NodeDependencyValidator implements DependencyValidatorPort {
  constructor(private readonly executor: SafeVerificationCommandExecutor) {}

  async validateDependencies(context: VerificationContext): Promise<VerificationStagePortResult> {
    this.executor.setExecutionContext(readExecutionContext(context));
    return this.executor.runDependencyValidation();
  }
}

export class NodeBuildRunner implements BuildRunnerPort {
  constructor(
    private readonly executor: SafeVerificationCommandExecutor,
    private readonly scripts: DiscoveredPackageScripts,
  ) {}

  async runBuild(context: VerificationContext): Promise<VerificationStagePortResult> {
    if (!this.scripts.hasBuild) return skippedStageResult('build');
    this.executor.setExecutionContext(readExecutionContext(context));
    return this.executor.runBuild();
  }
}

export class NodeTestRunner implements TestRunnerPort {
  constructor(
    private readonly executor: SafeVerificationCommandExecutor,
    private readonly scripts: DiscoveredPackageScripts,
  ) {}

  async runTests(context: VerificationContext): Promise<VerificationStagePortResult> {
    if (!this.scripts.hasTest) return skippedStageResult('test');
    this.executor.setExecutionContext(readExecutionContext(context));
    return this.executor.runTest();
  }
}

export class NodeLintRunner implements LintRunnerPort {
  constructor(
    private readonly executor: SafeVerificationCommandExecutor,
    private readonly scripts: DiscoveredPackageScripts,
  ) {}

  async runLint(context: VerificationContext): Promise<VerificationStagePortResult> {
    const script = this.scripts.lintScript;
    if (script === undefined) return skippedStageResult('lint');
    this.executor.setExecutionContext(readExecutionContext(context));
    return this.executor.runNamedScript('lint', script);
  }
}

export class NodeTypecheckRunner implements TypecheckRunnerPort {
  constructor(
    private readonly executor: SafeVerificationCommandExecutor,
    private readonly scripts: DiscoveredPackageScripts,
  ) {}

  async runTypecheck(context: VerificationContext): Promise<VerificationStagePortResult> {
    const script = this.scripts.typecheckScript;
    if (script === undefined) return skippedStageResult('typecheck');
    this.executor.setExecutionContext(readExecutionContext(context));
    return this.executor.runNamedScript('typecheck', script);
  }
}

export class NodeFormatRunner implements FormatRunnerPort {
  constructor(
    private readonly executor: SafeVerificationCommandExecutor,
    private readonly scripts: DiscoveredPackageScripts,
  ) {}

  async runFormat(context: VerificationContext): Promise<VerificationStagePortResult> {
    const script = this.scripts.formatScript;
    if (script === undefined) return skippedStageResult('format');
    this.executor.setExecutionContext(readExecutionContext(context));
    return this.executor.runNamedScript('format', script);
  }
}

export class SafeVerificationCommandExecutor {
  private readonly runner: SafeVerificationRunner;
  private readonly diagnosticLimits: {
    readonly maximumStdoutCharacters: number;
    readonly maximumStderrCharacters: number;
    readonly maximumCombinedCharacters: number;
  };
  private executionContext: NodeVerificationExecutionContext = {};

  constructor(private readonly configuration: NodeVerificationConfiguration) {
    this.runner = new SafeVerificationRunner({
      projectRoot: configuration.projectRoot,
      builderAiRoot: configuration.builderAiRoot,
      stageTimeoutMs: configuration.commandTimeoutMs,
      outputLimitBytes: configuration.maximumOutputBytes,
    });
    this.diagnosticLimits = {
      maximumStdoutCharacters:
        configuration.maximumDiagnosticStdoutCharacters ??
        DEFAULT_VERIFICATION_CONFIGURATION.maximumDiagnosticStdoutCharacters,
      maximumStderrCharacters:
        configuration.maximumDiagnosticStderrCharacters ??
        DEFAULT_VERIFICATION_CONFIGURATION.maximumDiagnosticStderrCharacters,
      maximumCombinedCharacters:
        configuration.maximumDiagnosticCombinedCharacters ??
        DEFAULT_VERIFICATION_CONFIGURATION.maximumDiagnosticCombinedCharacters,
    };
  }

  setExecutionContext(context: NodeVerificationExecutionContext): void {
    this.executionContext = context;
  }

  async runDependencyValidation(): Promise<VerificationStagePortResult> {
    const descriptor = createDependencyValidationDescriptor(this.policyConfiguration());
    const execution = await this.runner.execute(descriptor, this.executionContext);
    return mapExecutionToStageResult({
      descriptor,
      execution,
      failure: {
        failureCode: 'DEPENDENCY_VALIDATION_FAILED',
        message: 'Dependency validation exited unsuccessfully.',
      },
      diagnosticLimits: this.diagnosticLimits,
    });
  }

  async runBuild(): Promise<VerificationStagePortResult> {
    const descriptor = createBuildDescriptor(this.policyConfiguration());
    const execution = await this.runner.execute(descriptor, this.executionContext);
    return mapExecutionToStageResult({
      descriptor,
      execution,
      failure: { failureCode: 'BUILD_FAILED', message: 'Build validation exited unsuccessfully.' },
      diagnosticLimits: this.diagnosticLimits,
    });
  }

  async runTest(): Promise<VerificationStagePortResult> {
    const descriptor = createTestDescriptor(this.policyConfiguration());
    const execution = await this.runner.execute(descriptor, this.executionContext);
    return mapExecutionToStageResult({
      descriptor,
      execution,
      failure: { failureCode: 'TEST_FAILED', message: 'Test validation exited unsuccessfully.' },
      diagnosticLimits: this.diagnosticLimits,
    });
  }

  async runNamedScript(
    scriptKind: 'lint' | 'typecheck' | 'format',
    scriptName: string,
  ): Promise<VerificationStagePortResult> {
    const descriptor = createNamedScriptDescriptor(this.policyConfiguration(), {
      id: descriptorIdForScript(scriptKind),
      stage:
        scriptKind === 'lint'
          ? 'LINT_VALIDATION'
          : scriptKind === 'typecheck'
            ? 'TYPECHECK_VALIDATION'
            : 'FORMAT_VALIDATION',
      scriptName,
    });
    const execution = await this.runner.execute(descriptor, this.executionContext);
    const failureCode =
      scriptKind === 'lint'
        ? 'LINT_FAILED'
        : scriptKind === 'typecheck'
          ? 'TYPECHECK_FAILED'
          : 'FORMAT_FAILED';
    return mapExecutionToStageResult({
      descriptor,
      execution,
      failure: {
        failureCode,
        message: `${scriptKind} validation exited unsuccessfully.`,
      },
      diagnosticLimits: this.diagnosticLimits,
    });
  }

  private policyConfiguration() {
    return {
      projectRoot: path.resolve(this.configuration.projectRoot),
      builderAiRoot: this.configuration.builderAiRoot,
      stageTimeoutMs: this.configuration.commandTimeoutMs,
      outputLimitBytes: this.configuration.maximumOutputBytes,
    };
  }
}

export function createNodeVerificationRunners(configuration: NodeVerificationConfiguration): {
  readonly commandExecutor: SafeVerificationCommandExecutor;
  readonly scripts: DiscoveredPackageScripts;
  readonly dependencyValidator: NodeDependencyValidator;
  readonly buildRunner: NodeBuildRunner;
  readonly testRunner: NodeTestRunner;
  readonly lintRunner: NodeLintRunner;
  readonly typecheckRunner: NodeTypecheckRunner;
  readonly formatRunner: NodeFormatRunner;
} {
  const commandExecutor = new SafeVerificationCommandExecutor(configuration);
  const scripts = discoverPackageScripts(configuration.projectRoot);
  return {
    commandExecutor,
    scripts,
    dependencyValidator: new NodeDependencyValidator(commandExecutor),
    buildRunner: new NodeBuildRunner(commandExecutor, scripts),
    testRunner: new NodeTestRunner(commandExecutor, scripts),
    lintRunner: new NodeLintRunner(commandExecutor, scripts),
    typecheckRunner: new NodeTypecheckRunner(commandExecutor, scripts),
    formatRunner: new NodeFormatRunner(commandExecutor, scripts),
  };
}

function readExecutionContext(context: VerificationContext): NodeVerificationExecutionContext {
  return {
    remainingWorkflowMs: context.execution?.remainingWorkflowMs,
    cancellation: context.execution?.cancellation,
  };
}

function toMessage(diagnostic: {
  readonly code: string;
  readonly message: string;
}): VerificationMessage {
  return { code: diagnostic.code, message: diagnostic.message.slice(0, 2_000) };
}

export type { VerificationDiagnostic } from '../../core/verification';
