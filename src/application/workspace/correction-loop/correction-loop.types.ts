import type { ResponseMetadata } from '../../../core/response-processor';
import type { RuntimeBrowserOverallStatus } from '../../../core/runtime-verification';
import type { VerificationStatus } from '../../../core/verification';
import type { BoundedFailureDiagnostic } from '../failure-diagnostics';

export const CORRECTION_LOOP_SCHEMA_VERSION = 1 as const;

export const CORRECTION_LOOP_STATES = [
  'CORRECTION_NOT_STARTED',
  'CORRECTION_DIAGNOSING',
  'CORRECTION_PREPARING',
  'CORRECTION_READY_FOR_REVIEW',
  'CORRECTION_WAITING_FOR_APPROVAL',
  'CORRECTION_APPLYING',
  'CORRECTION_VERIFYING',
  'CORRECTION_PASSED',
  'CORRECTION_FAILED',
  'CORRECTION_EXHAUSTED',
  'CORRECTION_CANCELLED',
  'CORRECTION_BLOCKED',
  'CORRECTION_LOOP_DETECTED',
] as const;

export type CorrectionLoopState = (typeof CORRECTION_LOOP_STATES)[number];

export const CORRECTABLE_FAILURE_CATEGORIES = [
  'BUILD_FAILURE',
  'TEST_FAILURE',
  'LINT_FAILURE',
  'TYPECHECK_FAILURE',
  'FORMAT_FAILURE',
  'RUNTIME_START_FAILURE',
  'RUNTIME_HTTP_FAILURE',
  'BROWSER_PAGE_ERROR',
  'BROWSER_CONSOLE_ERROR',
  'BROWSER_NETWORK_ERROR',
  'BROWSER_TIMEOUT',
  'UNKNOWN_VERIFICATION_FAILURE',
] as const;

export const NON_CORRECTABLE_FAILURE_CATEGORIES = [
  'POLICY_BLOCKED',
  'PROTECTED_PATH',
  'SECURITY_VIOLATION',
  'CREDENTIAL_FAILURE',
  'PROVIDER_FAILURE',
  'CANCELLATION',
  'USER_REJECTION',
  'RECOVERY_REQUIRED',
  'INDETERMINATE_MUTATION',
] as const;

export type CorrectableFailureCategory = (typeof CORRECTABLE_FAILURE_CATEGORIES)[number];
export type NonCorrectableFailureCategory = (typeof NON_CORRECTABLE_FAILURE_CATEGORIES)[number];
export type CorrectionFailureCategory = CorrectableFailureCategory | NonCorrectableFailureCategory;

export interface CorrectionLoopConfiguration {
  readonly maximumCorrectionAttempts: number;
  readonly hardMaximumCorrectionAttempts: number;
  readonly workflowDeadlineMs: number;
}

export const DEFAULT_CORRECTION_LOOP_CONFIGURATION: CorrectionLoopConfiguration = {
  maximumCorrectionAttempts: 2,
  hardMaximumCorrectionAttempts: 3,
  workflowDeadlineMs: 300_000,
};

export interface CorrectionDiagnosticEvidence {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly route?: string;
}

export interface CorrectionDiagnostic {
  readonly schemaVersion: typeof CORRECTION_LOOP_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly attempt: number;
  readonly failureStage: string;
  readonly failureCategory: CorrectionFailureCategory;
  readonly summary: string;
  readonly affectedRoutes: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly diagnostics: readonly CorrectionDiagnosticEvidence[];
  /**
   * ADR-052 Slice 2 — validated planning DATA only.
   * Must not feed mutation-scope validators (buildCorrectionAllowedPaths).
   */
  readonly structuredFailureDiagnostics?: readonly BoundedFailureDiagnostic[];
  readonly evidenceReferences: readonly string[];
  readonly verificationStatus?: VerificationStatus;
  readonly runtimeStatus?: RuntimeBrowserOverallStatus;
  readonly browserStatus?: string;
  readonly diagnosticDigest: string;
  readonly sufficientEvidence: boolean;
  readonly metadata: ResponseMetadata;
}

export interface CorrectionAttemptRecord {
  readonly attempt: number;
  readonly failureCategory: CorrectionFailureCategory;
  readonly diagnosticDigest: string;
  readonly changePlanDigest?: string;
  readonly changedPaths: readonly string[];
  readonly preparationId?: string;
  readonly completedAt: string;
}

export interface CorrectionLoopSession {
  readonly schemaVersion: typeof CORRECTION_LOOP_SCHEMA_VERSION;
  readonly workflowId: string;
  readonly state: CorrectionLoopState;
  readonly attempt: number;
  readonly maximumAttempts: number;
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly originalTaskSummary?: string;
  readonly sourcePreparationId?: string;
  readonly priorRequestSummary?: string;
  readonly currentDiagnostic?: CorrectionDiagnostic;
  readonly correctionRequest?: string;
  readonly preparationId?: string;
  readonly changePlanDigest?: string;
  readonly attemptHistory: readonly CorrectionAttemptRecord[];
  readonly blockCode?: string;
  readonly blockMessage?: string;
}

export interface CorrectionLoopBeginInput {
  readonly workflowId: string;
  readonly originalTaskSummary?: string;
  readonly sourcePreparationId?: string;
  readonly priorRequestSummary?: string;
  readonly applyStatus: string;
  readonly createdPaths: readonly string[];
  readonly updatedPaths: readonly string[];
  readonly deletedPaths: readonly string[];
  readonly verificationReport?: {
    readonly status: VerificationStatus;
    readonly stages: readonly {
      readonly stage: string;
      readonly status: string;
      readonly errors: readonly { readonly code: string; readonly message: string }[];
    }[];
    readonly errors: readonly { readonly code: string; readonly message: string }[];
  };
  /** Server-derived Slice 2 planning DATA. Must not be accepted from HTTP. */
  readonly structuredFailureDiagnostics?: readonly BoundedFailureDiagnostic[];
  readonly runtimeBrowserVerificationReport?: {
    readonly status: RuntimeBrowserOverallStatus;
    readonly server: { readonly status: string; readonly policyBlockCode?: string };
    readonly browser: {
      readonly status: string;
      readonly routes: readonly {
        readonly path: string;
        readonly status: string;
        readonly consoleErrors: readonly { readonly message: string }[];
        readonly pageExceptions: readonly string[];
        readonly failedRequests: readonly { readonly url: string }[];
      }[];
    };
  };
}

export interface CorrectionLoopBeginResult {
  readonly session: CorrectionLoopSession;
  readonly correctionRequest: string;
  readonly canPrepare: boolean;
}
