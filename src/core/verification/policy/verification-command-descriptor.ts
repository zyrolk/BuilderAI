import type { VerificationStage } from '../types';

export const VERIFICATION_COMMAND_DESCRIPTOR_IDS = [
  'npm-ls-omit-dev-json',
  'npm-run-build',
  'npm-run-test',
  'npm-run-lint',
  'npm-run-typecheck',
  'npm-run-format',
  'npm-run-named-script',
] as const;

export type VerificationCommandDescriptorId = (typeof VERIFICATION_COMMAND_DESCRIPTOR_IDS)[number];

export const VERIFICATION_NETWORK_POLICIES = ['disabled-unsupported', 'disabled-enforced'] as const;

export type VerificationNetworkPolicy = (typeof VERIFICATION_NETWORK_POLICIES)[number];

export const VERIFICATION_WORKING_DIRECTORY_POLICIES = ['project-root'] as const;

export type VerificationWorkingDirectoryPolicy =
  (typeof VERIFICATION_WORKING_DIRECTORY_POLICIES)[number];

export const VERIFICATION_ENVIRONMENT_POLICIES = ['allowlisted-minimal'] as const;

export type VerificationEnvironmentPolicy = (typeof VERIFICATION_ENVIRONMENT_POLICIES)[number];

/**
 * Immutable, server-authored command template. Providers must never construct these directly.
 */
export interface VerificationCommandDescriptor {
  readonly id: VerificationCommandDescriptorId;
  readonly stage: VerificationStage;
  readonly executableKind: 'npm';
  readonly fixedArguments: readonly string[];
  readonly scriptName?: string;
  readonly workingDirectoryPolicy: VerificationWorkingDirectoryPolicy;
  readonly environmentPolicy: VerificationEnvironmentPolicy;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly networkPolicy: VerificationNetworkPolicy;
}
