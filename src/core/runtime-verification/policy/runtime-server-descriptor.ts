import type { SupportedRuntimeFramework } from '../types/runtime-verification.types';

export const RUNTIME_SERVER_DESCRIPTOR_IDS = [
  'npm-run-dev',
  'npm-run-start',
  'npm-run-preview',
] as const;

export type RuntimeServerDescriptorId = (typeof RUNTIME_SERVER_DESCRIPTOR_IDS)[number];

export const DEV_SERVER_SCRIPT_CANDIDATES = ['dev', 'start', 'preview'] as const;

export interface RuntimeServerDescriptor {
  readonly id: RuntimeServerDescriptorId;
  readonly framework: SupportedRuntimeFramework;
  readonly executableKind: 'npm';
  readonly fixedArguments: readonly string[];
  readonly scriptName: string;
  readonly workingDirectoryPolicy: 'project-root';
  readonly environmentPolicy: 'allowlisted-minimal';
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly outputLimitBytes: number;
  readonly bindHost: '127.0.0.1';
}
