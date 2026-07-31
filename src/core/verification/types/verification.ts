import type { FileApplyResult } from '../../file-apply';
import type { ResponseMetadata } from '../../response-processor';

export const VERIFICATION_REPORT_SCHEMA_VERSION = 1 as const;
export const VERIFICATION_STAGES = [
  'PROJECT_VALIDATION',
  'DEPENDENCY_VALIDATION',
  'BUILD_VALIDATION',
  'TEST_VALIDATION',
] as const;
export const VERIFICATION_STATUSES = ['PASSED', 'FAILED', 'PARTIALLY_PASSED'] as const;
export const VERIFICATION_STAGE_STATUSES = ['PASSED', 'FAILED'] as const;

export const VERIFICATION_VALIDATION_CODES = [
  'INVALID_APPLY_RESULT',
  'INVALID_CONFIGURATION',
  'INVALID_PORT_RESULT',
  'INVALID_REPORT',
  'INVALID_STAGE_ORDER',
  'STAGE_CONTRACT_VIOLATION',
  'STAGE_EXECUTION_FAILED',
  'UNSUPPORTED_REPORT_VERSION',
] as const;

export type VerificationStage = (typeof VERIFICATION_STAGES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type VerificationStageStatus = (typeof VERIFICATION_STAGE_STATUSES)[number];
export type VerificationValidationCode = (typeof VERIFICATION_VALIDATION_CODES)[number];

export interface VerificationMessage {
  readonly code: string;
  readonly message: string;
}

export interface VerificationFinding extends VerificationMessage {
  readonly stage: VerificationStage;
}

export interface VerificationStagePortResult {
  readonly status: VerificationStageStatus;
  readonly warnings: readonly VerificationMessage[];
  readonly errors: readonly VerificationMessage[];
  readonly metadata: ResponseMetadata;
}

export interface VerificationStageResult extends VerificationStagePortResult {
  readonly stage: VerificationStage;
  readonly durationMs: number;
}

export interface VerificationContext {
  readonly fileApplyResult: FileApplyResult;
  readonly affectedFiles: {
    readonly created: readonly string[];
    readonly updated: readonly string[];
    readonly deleted: readonly string[];
  };
  readonly metadata: ResponseMetadata;
}

export interface VerificationReport {
  readonly schemaVersion: typeof VERIFICATION_REPORT_SCHEMA_VERSION;
  readonly status: VerificationStatus;
  readonly stages: readonly VerificationStageResult[];
  readonly warnings: readonly VerificationFinding[];
  readonly errors: readonly VerificationFinding[];
  readonly durationMs: number;
  readonly metadata: ResponseMetadata;
}

export interface VerificationValidationIssue {
  readonly code: VerificationValidationCode;
  readonly path: string;
  readonly message: string;
}
