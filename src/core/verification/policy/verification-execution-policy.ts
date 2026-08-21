import path from 'node:path';

import type {
  VerificationCommandDescriptor,
  VerificationCommandDescriptorId,
} from './verification-command-descriptor';
import {
  FORMAT_SCRIPT_CANDIDATES,
  LINT_SCRIPT_CANDIDATES,
  TYPECHECK_SCRIPT_CANDIDATES,
} from './verification-script-candidates';

export class VerificationPolicyViolationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'VerificationPolicyViolationError';
  }
}

export const FORBIDDEN_NPM_SUBCOMMANDS = [
  'install',
  'ci',
  'update',
  'audit',
  'exec',
  'run-script',
  'x',
  'npx',
  'cache',
  'publish',
  'uninstall',
  'link',
  'dedupe',
  'rebuild',
  'root',
  'config',
  'set',
  'get',
  'delete',
  'edit',
  'explore',
  'init',
  'create',
  'login',
  'logout',
  'whoami',
  'token',
  'owner',
  'access',
  'deprecate',
  'dist-tag',
  'version',
  'shrinkwrap',
  'pack',
  'prefix',
  'doctor',
  'fund',
  'help',
  'hook',
  'ping',
  'profile',
  'repo',
  'search',
  'star',
  'stars',
  'team',
  'unstar',
  'view',
  'outdated',
  'find-dupes',
  'ls',
  'll',
  'la',
  'explain',
  'prune',
  'unpublish',
] as const;

export const FORBIDDEN_EXECUTABLES = [
  'cmd',
  'cmd.exe',
  'powershell',
  'powershell.exe',
  'pwsh',
  'pwsh.exe',
  'bash',
  'sh',
  'git',
  'git.exe',
  'npx',
  'npx.cmd',
  'node',
  'python',
  'python3',
] as const;

export const ALLOWED_NPM_RUN_SCRIPT_NAMES = new Set([
  'build',
  'test',
  ...LINT_SCRIPT_CANDIDATES,
  ...TYPECHECK_SCRIPT_CANDIDATES,
  ...FORMAT_SCRIPT_CANDIDATES,
]);

const ALLOWED_NPM_LS_ARGUMENTS = ['ls', '--omit=dev', '--json', '--depth=0'] as const;

export interface VerificationExecutionPolicyConfiguration {
  readonly projectRoot: string;
  readonly builderAiRoot?: string;
  readonly stageTimeoutMs: number;
  readonly outputLimitBytes: number;
}

export function assertProjectRootConfinement(projectRoot: string, builderAiRoot?: string): string {
  const resolved = path.resolve(projectRoot);
  if (containsTraversal(resolved)) {
    throw new VerificationPolicyViolationError(
      'WORKING_DIRECTORY_TRAVERSAL',
      'Project root contains path traversal segments.',
    );
  }
  if (builderAiRoot !== undefined) {
    const builderRoot = path.resolve(builderAiRoot);
    if (pathsEqual(resolved, builderRoot) || isPathWithin(resolved, builderRoot)) {
      throw new VerificationPolicyViolationError(
        'BUILDERAI_ROOT_FORBIDDEN',
        'Verification cannot run against the BuilderAI repository root.',
      );
    }
  }
  return resolved;
}

export function assertWorkingDirectoryAllowed(workingDirectory: string, projectRoot: string): void {
  const resolvedWorkingDirectory = path.resolve(workingDirectory);
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (!pathsEqual(resolvedWorkingDirectory, resolvedProjectRoot)) {
    throw new VerificationPolicyViolationError(
      'WORKING_DIRECTORY_OUTSIDE_ROOT',
      'Verification working directory must equal the target project root.',
    );
  }
  if (containsTraversal(resolvedWorkingDirectory)) {
    throw new VerificationPolicyViolationError(
      'WORKING_DIRECTORY_TRAVERSAL',
      'Working directory contains traversal segments.',
    );
  }
}

export function assertArgumentPathSafe(argument: string, projectRoot: string): void {
  if (argument.includes('\0')) {
    throw new VerificationPolicyViolationError('INVALID_ARGUMENT', 'Argument contains null bytes.');
  }
  if (argument.startsWith('-')) return;
  if (!path.isAbsolute(argument)) {
    if (containsTraversal(argument)) {
      throw new VerificationPolicyViolationError(
        'ARGUMENT_TRAVERSAL',
        'Relative argument contains traversal segments.',
      );
    }
    return;
  }
  const resolved = path.resolve(argument);
  const root = path.resolve(projectRoot);
  if (!isPathWithin(resolved, root) && !pathsEqual(resolved, root)) {
    throw new VerificationPolicyViolationError(
      'ABSOLUTE_PATH_OUTSIDE_ROOT',
      'Absolute argument resolves outside the project root.',
    );
  }
}

export function validateCommandDescriptorAgainstPolicy(
  descriptor: VerificationCommandDescriptor,
  configuration: VerificationExecutionPolicyConfiguration,
): void {
  const projectRoot = assertProjectRootConfinement(
    configuration.projectRoot,
    configuration.builderAiRoot,
  );
  assertWorkingDirectoryAllowed(projectRoot, projectRoot);
  for (const argument of descriptor.fixedArguments) {
    assertArgumentPathSafe(argument, projectRoot);
  }
  if (descriptor.timeoutMs <= 0 || descriptor.timeoutMs > configuration.stageTimeoutMs) {
    throw new VerificationPolicyViolationError(
      'TIMEOUT_OUT_OF_POLICY',
      'Command descriptor timeout exceeds policy.',
    );
  }
  if (
    descriptor.outputLimitBytes <= 0 ||
    descriptor.outputLimitBytes > configuration.outputLimitBytes
  ) {
    throw new VerificationPolicyViolationError(
      'OUTPUT_LIMIT_OUT_OF_POLICY',
      'Command descriptor output limit exceeds policy.',
    );
  }
  validateDescriptorArguments(descriptor);
}

export function validateDescriptorArguments(descriptor: VerificationCommandDescriptor): void {
  const args = descriptor.fixedArguments;
  if (args.length === 0) {
    throw new VerificationPolicyViolationError(
      'EMPTY_ARGUMENTS',
      'Command descriptor has no arguments.',
    );
  }
  switch (descriptor.id) {
    case 'npm-ls-omit-dev-json':
      if (!arraysEqual(args, ALLOWED_NPM_LS_ARGUMENTS)) {
        throw new VerificationPolicyViolationError(
          'FORBIDDEN_NPM_COMMAND',
          'Dependency validation must use the fixed npm ls descriptor.',
        );
      }
      return;
    case 'npm-run-build':
      if (!arraysEqual(args, ['run', 'build'])) {
        throw new VerificationPolicyViolationError(
          'FORBIDDEN_NPM_COMMAND',
          'Build validation must use npm run build.',
        );
      }
      return;
    case 'npm-run-test':
      if (!arraysEqual(args, ['test'])) {
        throw new VerificationPolicyViolationError(
          'FORBIDDEN_NPM_COMMAND',
          'Test validation must use npm test.',
        );
      }
      return;
    case 'npm-run-lint':
    case 'npm-run-typecheck':
    case 'npm-run-format':
    case 'npm-run-named-script':
      return validateNpmRunScriptArguments(args, descriptor.scriptName);
  }
}

function validateNpmRunScriptArguments(
  args: readonly string[],
  scriptName: string | undefined,
): void {
  if (args.length !== 2 || args[0] !== 'run') {
    throw new VerificationPolicyViolationError(
      'FORBIDDEN_NPM_COMMAND',
      'Script validation must use npm run <script>.',
    );
  }
  const candidate = args[1];
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new VerificationPolicyViolationError('INVALID_SCRIPT_NAME', 'Script name is required.');
  }
  if (candidate.startsWith('-')) {
    throw new VerificationPolicyViolationError(
      'FORBIDDEN_SCRIPT_FLAGS',
      'Script names cannot start with flags.',
    );
  }
  if (scriptName !== undefined && candidate !== scriptName) {
    throw new VerificationPolicyViolationError(
      'SCRIPT_NAME_MISMATCH',
      'Descriptor script name does not match fixed arguments.',
    );
  }
  if (!ALLOWED_NPM_RUN_SCRIPT_NAMES.has(candidate)) {
    throw new VerificationPolicyViolationError(
      'FORBIDDEN_SCRIPT_NAME',
      `Script "${candidate}" is not allowlisted for verification.`,
    );
  }
}

export function rejectForbiddenShellInvocation(executable: string, args: readonly string[]): void {
  const normalizedExecutable = path.basename(executable).toLowerCase();
  if (FORBIDDEN_EXECUTABLES.some((forbidden) => normalizedExecutable === forbidden.toLowerCase())) {
    throw new VerificationPolicyViolationError(
      'FORBIDDEN_EXECUTABLE',
      `Executable "${normalizedExecutable}" is not allowlisted.`,
    );
  }
  if (args.some((argument) => argument === '-c' || argument === '/c')) {
    throw new VerificationPolicyViolationError(
      'FORBIDDEN_SHELL_INTERPOLATION',
      'Shell command interpolation is forbidden.',
    );
  }
}

export function rejectForbiddenNpmArguments(args: readonly string[]): void {
  const subcommand = args[0]?.toLowerCase();
  if (subcommand === undefined) {
    throw new VerificationPolicyViolationError(
      'EMPTY_NPM_ARGUMENTS',
      'npm arguments are required.',
    );
  }
  if (subcommand === 'run' || subcommand === 'test') {
    if (args.some((argument, index) => index > 0 && argument.startsWith('-'))) {
      throw new VerificationPolicyViolationError(
        'FORBIDDEN_NPM_FLAGS',
        'Arbitrary npm flags are forbidden during verification.',
      );
    }
  }
  if (
    subcommand !== 'run' &&
    subcommand !== 'test' &&
    subcommand !== 'ls' &&
    FORBIDDEN_NPM_SUBCOMMANDS.includes(subcommand as (typeof FORBIDDEN_NPM_SUBCOMMANDS)[number])
  ) {
    throw new VerificationPolicyViolationError(
      'FORBIDDEN_NPM_SUBCOMMAND',
      `npm ${subcommand} is forbidden during verification.`,
    );
  }
  if (subcommand === 'install' || subcommand === 'ci' || subcommand === 'update') {
    throw new VerificationPolicyViolationError(
      'FORBIDDEN_PACKAGE_MUTATION',
      'Package installation and mutation commands are forbidden.',
    );
  }
}

export function createDependencyValidationDescriptor(
  configuration: VerificationExecutionPolicyConfiguration,
): VerificationCommandDescriptor {
  return {
    id: 'npm-ls-omit-dev-json',
    stage: 'DEPENDENCY_VALIDATION',
    executableKind: 'npm',
    fixedArguments: [...ALLOWED_NPM_LS_ARGUMENTS],
    workingDirectoryPolicy: 'project-root',
    environmentPolicy: 'allowlisted-minimal',
    timeoutMs: configuration.stageTimeoutMs,
    outputLimitBytes: configuration.outputLimitBytes,
    networkPolicy: 'disabled-unsupported',
  };
}

export function createBuildDescriptor(
  configuration: VerificationExecutionPolicyConfiguration,
): VerificationCommandDescriptor {
  return {
    id: 'npm-run-build',
    stage: 'BUILD_VALIDATION',
    executableKind: 'npm',
    fixedArguments: ['run', 'build'],
    workingDirectoryPolicy: 'project-root',
    environmentPolicy: 'allowlisted-minimal',
    timeoutMs: configuration.stageTimeoutMs,
    outputLimitBytes: configuration.outputLimitBytes,
    networkPolicy: 'disabled-unsupported',
  };
}

export function createTestDescriptor(
  configuration: VerificationExecutionPolicyConfiguration,
): VerificationCommandDescriptor {
  return {
    id: 'npm-run-test',
    stage: 'TEST_VALIDATION',
    executableKind: 'npm',
    fixedArguments: ['test'],
    workingDirectoryPolicy: 'project-root',
    environmentPolicy: 'allowlisted-minimal',
    timeoutMs: configuration.stageTimeoutMs,
    outputLimitBytes: configuration.outputLimitBytes,
    networkPolicy: 'disabled-unsupported',
  };
}

export function createNamedScriptDescriptor(
  configuration: VerificationExecutionPolicyConfiguration,
  input: {
    readonly id: Extract<
      VerificationCommandDescriptorId,
      'npm-run-lint' | 'npm-run-typecheck' | 'npm-run-format'
    >;
    readonly stage: VerificationCommandDescriptor['stage'];
    readonly scriptName: string;
  },
): VerificationCommandDescriptor {
  return {
    id: input.id,
    stage: input.stage,
    executableKind: 'npm',
    fixedArguments: ['run', input.scriptName],
    scriptName: input.scriptName,
    workingDirectoryPolicy: 'project-root',
    environmentPolicy: 'allowlisted-minimal',
    timeoutMs: configuration.stageTimeoutMs,
    outputLimitBytes: configuration.outputLimitBytes,
    networkPolicy: 'disabled-unsupported',
  };
}

function containsTraversal(value: string): boolean {
  return value.split(/[\\/]/).some((segment) => segment === '..');
}

function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathsEqual(left: string, right: string): boolean {
  return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
