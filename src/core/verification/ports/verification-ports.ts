import type { BuildRunnerPort } from './build-runner.port';
import type { DependencyValidatorPort } from './dependency-validator.port';
import type { FormatRunnerPort } from './format-runner.port';
import type { LintRunnerPort } from './lint-runner.port';
import type { ProjectValidatorPort } from './project-validator.port';
import type { TestRunnerPort } from './test-runner.port';
import type { TypecheckRunnerPort } from './typecheck-runner.port';

export interface VerificationPorts {
  readonly projectValidator: ProjectValidatorPort;
  readonly dependencyValidator: DependencyValidatorPort;
  readonly buildRunner: BuildRunnerPort;
  readonly testRunner: TestRunnerPort;
  readonly lintRunner: LintRunnerPort;
  readonly typecheckRunner: TypecheckRunnerPort;
  readonly formatRunner: FormatRunnerPort;
}
