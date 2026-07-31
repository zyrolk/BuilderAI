import type { BuildRunnerPort } from './build-runner.port';
import type { DependencyValidatorPort } from './dependency-validator.port';
import type { ProjectValidatorPort } from './project-validator.port';
import type { TestRunnerPort } from './test-runner.port';

export interface VerificationPorts {
  readonly projectValidator: ProjectValidatorPort;
  readonly dependencyValidator: DependencyValidatorPort;
  readonly buildRunner: BuildRunnerPort;
  readonly testRunner: TestRunnerPort;
}
