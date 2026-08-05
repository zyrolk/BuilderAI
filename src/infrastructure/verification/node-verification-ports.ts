import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { ProjectContextReaderPort } from '../../core/target-project';
import type {
  BuildRunnerPort,
  DependencyValidatorPort,
  LintRunnerPort,
  ProjectValidatorPort,
  TestRunnerPort,
  TypecheckRunnerPort,
  VerificationContext,
  VerificationMessage,
  VerificationStagePortResult,
} from '../../core/verification';
import { discoverPackageScripts, type DiscoveredPackageScripts } from './package-script-discovery';

export interface NodeVerificationConfiguration {
  readonly projectRoot: string;
  readonly commandTimeoutMs: number;
  readonly maximumOutputBytes: number;
}

interface CommandResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly outputBytes: number;
  readonly outputTruncated: boolean;
}

interface RunOptions {
  readonly failureCode: string;
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
  constructor(private readonly runner: BoundedNpmCommandRunner) {}

  async validateDependencies(context: VerificationContext): Promise<VerificationStagePortResult> {
    void context;
    return this.runner.run('dependency-validation', ['ls', '--omit=dev', '--json', '--depth=0'], {
      failureCode: 'DEPENDENCY_VALIDATION_FAILED',
    });
  }
}

export class NodeBuildRunner implements BuildRunnerPort {
  constructor(private readonly runner: BoundedNpmCommandRunner) {}

  async runBuild(context: VerificationContext): Promise<VerificationStagePortResult> {
    void context;
    return this.runner.run('build-validation', ['run', 'build'], { failureCode: 'BUILD_FAILED' });
  }
}

export class NodeTestRunner implements TestRunnerPort {
  constructor(private readonly runner: BoundedNpmCommandRunner) {}

  async runTests(context: VerificationContext): Promise<VerificationStagePortResult> {
    void context;
    return this.runner.run('test-validation', ['test'], { failureCode: 'TEST_FAILED' });
  }
}

export class NodeLintRunner implements LintRunnerPort {
  constructor(
    private readonly runner: BoundedNpmCommandRunner,
    private readonly scripts: DiscoveredPackageScripts,
  ) {}

  async runLint(context: VerificationContext): Promise<VerificationStagePortResult> {
    void context;
    const script = this.scripts.lintScript;
    if (script === undefined) {
      return skippedOptionalStage('lint');
    }
    return this.runner.run('lint-validation', ['run', script], { failureCode: 'LINT_FAILED' });
  }
}

export class NodeTypecheckRunner implements TypecheckRunnerPort {
  constructor(
    private readonly runner: BoundedNpmCommandRunner,
    private readonly scripts: DiscoveredPackageScripts,
  ) {}

  async runTypecheck(context: VerificationContext): Promise<VerificationStagePortResult> {
    void context;
    const script = this.scripts.typecheckScript;
    if (script === undefined) {
      return skippedOptionalStage('typecheck');
    }
    return this.runner.run('typecheck-validation', ['run', script], {
      failureCode: 'TYPECHECK_FAILED',
    });
  }
}

export function createNodeVerificationRunners(configuration: NodeVerificationConfiguration): {
  readonly commandRunner: BoundedNpmCommandRunner;
  readonly scripts: DiscoveredPackageScripts;
  readonly dependencyValidator: NodeDependencyValidator;
  readonly buildRunner: NodeBuildRunner;
  readonly testRunner: NodeTestRunner;
  readonly lintRunner: NodeLintRunner;
  readonly typecheckRunner: NodeTypecheckRunner;
} {
  const commandRunner = new BoundedNpmCommandRunner(configuration);
  const scripts = discoverPackageScripts(configuration.projectRoot);
  return {
    commandRunner,
    scripts,
    dependencyValidator: new NodeDependencyValidator(commandRunner),
    buildRunner: new NodeBuildRunner(commandRunner),
    testRunner: new NodeTestRunner(commandRunner),
    lintRunner: new NodeLintRunner(commandRunner, scripts),
    typecheckRunner: new NodeTypecheckRunner(commandRunner, scripts),
  };
}

export class BoundedNpmCommandRunner {
  private readonly root: string;

  constructor(private readonly configuration: NodeVerificationConfiguration) {
    this.root = path.resolve(configuration.projectRoot);
    if (
      !Number.isSafeInteger(configuration.commandTimeoutMs) ||
      configuration.commandTimeoutMs <= 0 ||
      !Number.isSafeInteger(configuration.maximumOutputBytes) ||
      configuration.maximumOutputBytes <= 0
    ) {
      throw new Error('Node verification configuration is invalid.');
    }
  }

  async run(
    stageName: string,
    arguments_: readonly string[],
    options: RunOptions,
  ): Promise<VerificationStagePortResult> {
    const invocation = npmInvocation(arguments_);
    const result = await executeBounded(
      invocation.executable,
      invocation.arguments,
      this.root,
      this.configuration,
    );
    const errors: VerificationMessage[] = [];
    const warnings: VerificationMessage[] = [];
    if (result.timedOut) {
      errors.push({
        code: 'VERIFICATION_COMMAND_TIMEOUT',
        message: `${stageName} exceeded its time limit.`,
      });
    } else if (result.exitCode !== 0) {
      errors.push({
        code: options.failureCode,
        message: `${stageName} exited unsuccessfully.`,
      });
    }
    if (result.outputTruncated) {
      warnings.push({
        code: 'OUTPUT_TRUNCATED',
        message: `${stageName} output exceeded the configured diagnostic limit.`,
      });
    }
    return {
      status: errors.length === 0 ? 'PASSED' : 'FAILED',
      warnings,
      errors,
      metadata: {
        'exit-code': result.exitCode ?? -1,
        'output-bytes': result.outputBytes,
        'output-truncated': result.outputTruncated,
      },
    };
  }
}

function skippedOptionalStage(scriptKind: 'lint' | 'typecheck'): VerificationStagePortResult {
  return {
    status: 'PASSED',
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

function npmInvocation(arguments_: readonly string[]): {
  readonly executable: string;
  readonly arguments: readonly string[];
} {
  if (process.platform !== 'win32') return { executable: 'npm', arguments: arguments_ };
  const configured = process.env.npm_execpath;
  const installed = path.resolve(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const cliPath = configured !== undefined && existsSync(configured) ? configured : installed;
  if (!existsSync(cliPath)) throw new Error('The npm CLI entry point could not be located.');
  return { executable: process.execPath, arguments: [cliPath, ...arguments_] };
}

function executeBounded(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  configuration: NodeVerificationConfiguration,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], {
      cwd,
      env: restrictedEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const observe = (chunk: Buffer | string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > configuration.maximumOutputBytes) outputTruncated = true;
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    child.once('error', reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      hardKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
      hardKill.unref();
    }, configuration.commandTimeoutMs);
    timeout.unref();
    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      if (hardKill !== undefined) clearTimeout(hardKill);
      resolve({ exitCode, timedOut, outputBytes, outputTruncated });
    });
  });
}

function restrictedEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'APPDATA',
    'CI',
    'ComSpec',
    'HOME',
    'LOCALAPPDATA',
    'NODE_ENV',
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'TEMP',
    'TMP',
    'USERPROFILE',
  ] as const;
  return {
    NODE_ENV: process.env.NODE_ENV ?? 'production',
    ...Object.fromEntries(
      allowed.flatMap((name) => {
        const value = process.env[name];
        return value === undefined ? [] : [[name, value]];
      }),
    ),
  };
}

function toMessage(diagnostic: {
  readonly code: string;
  readonly message: string;
}): VerificationMessage {
  return { code: diagnostic.code, message: diagnostic.message.slice(0, 2_000) };
}
