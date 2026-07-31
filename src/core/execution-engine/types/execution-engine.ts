import type { PromptMetadata, PromptPackage } from '../../prompt-orchestrator';
import type { ExecutionCancellationToken } from '../ports';

export const EXECUTION_REQUEST_SCHEMA_VERSION = 1 as const;
export const EXECUTION_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const EXECUTION_RESULT_SCHEMA_VERSION = 1 as const;

export const EXECUTION_STATES = [
  'CREATED',
  'VALIDATED',
  'QUEUED',
  'PREPARING',
  'READY',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'TIMED_OUT',
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];
export type TerminalExecutionState = 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';

export const EXECUTION_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
export type ExecutionPriority = (typeof EXECUTION_PRIORITIES)[number];

export const EXECUTION_VALIDATION_MODES = ['STRICT', 'SCHEMA_ONLY'] as const;
export type ExecutionValidationMode = (typeof EXECUTION_VALIDATION_MODES)[number];

export const EXECUTION_FAILURE_STRATEGIES = ['FAIL_FAST', 'RETRY_THEN_FAIL'] as const;
export type ExecutionFailureStrategy = (typeof EXECUTION_FAILURE_STRATEGIES)[number];

export const RETRY_DELAY_STRATEGIES = ['NONE', 'FIXED', 'EXPONENTIAL'] as const;
export type RetryDelayStrategy = (typeof RETRY_DELAY_STRATEGIES)[number];

export interface ExecutionRetryPolicy {
  readonly maximumRetries: number;
  readonly delayStrategy: RetryDelayStrategy;
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly retryableErrorCodes: readonly string[];
}

export const TIMEOUT_START_STATES = ['QUEUED', 'PREPARING', 'READY', 'EXECUTING'] as const;
export type TimeoutStartState = (typeof TIMEOUT_START_STATES)[number];

export interface ExecutionTimeoutPolicy {
  readonly durationMs: number;
  readonly startsAt: TimeoutStartState;
}

export interface ExecutionPolicy {
  readonly priority: ExecutionPriority;
  readonly validationMode: ExecutionValidationMode;
  readonly failureStrategy: ExecutionFailureStrategy;
  readonly retry: ExecutionRetryPolicy;
  readonly timeout: ExecutionTimeoutPolicy;
}

export interface ExecutionMetadata {
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly values: PromptMetadata;
}

export interface ExecutionRequest {
  readonly schemaVersion: typeof EXECUTION_REQUEST_SCHEMA_VERSION;
  readonly executionId: string;
  readonly prompt: PromptPackage;
  readonly metadata: ExecutionMetadata;
  readonly policy: ExecutionPolicy;
  readonly cancellation: ExecutionCancellationToken;
}

export interface ExecutionTransition {
  readonly sequence: number;
  readonly from: ExecutionState;
  readonly to: ExecutionState;
  readonly occurredAt: string;
  readonly reason?: string;
}

export interface ExecutionSnapshot {
  readonly schemaVersion: typeof EXECUTION_SNAPSHOT_SCHEMA_VERSION;
  readonly executionId: string;
  readonly state: ExecutionState;
  readonly attempt: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly history: readonly ExecutionTransition[];
}

export interface ExecutionFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type RetryDecisionReason =
  | 'CANCELLATION_REQUESTED'
  | 'FAIL_FAST'
  | 'NOT_RETRYABLE'
  | 'RETRY_LIMIT_REACHED'
  | 'RETRY_SCHEDULED';

export interface ExecutionRetryDecision {
  readonly shouldRetry: boolean;
  readonly nextAttempt: number;
  readonly delayMs: number;
  readonly reason: RetryDecisionReason;
}

export interface ExecutionTimeoutAssessment {
  readonly active: boolean;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly startedAt?: string;
}

export const EXECUTION_DIAGNOSTIC_SEVERITIES = ['INFO', 'WARNING', 'ERROR'] as const;
export type ExecutionDiagnosticSeverity = (typeof EXECUTION_DIAGNOSTIC_SEVERITIES)[number];

export interface ExecutionDiagnostic {
  readonly code: string;
  readonly severity: ExecutionDiagnosticSeverity;
  readonly message: string;
}

export const EXECUTION_ARTIFACT_KINDS = ['TEXT', 'STRUCTURED_DATA', 'FILE', 'IMAGE'] as const;
export type ExecutionArtifactKind = (typeof EXECUTION_ARTIFACT_KINDS)[number];

export interface ExecutionArtifactPlaceholder {
  readonly id: string;
  readonly name: string;
  readonly kind: ExecutionArtifactKind;
  readonly state: 'PLACEHOLDER';
}

export interface ExecutionUsagePlaceholder {
  readonly promptCharacters: number;
  readonly outputCharacters?: number;
  readonly estimated: boolean;
}

export interface ExecutionTiming {
  readonly createdAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

export interface ExecutionResult {
  readonly schemaVersion: typeof EXECUTION_RESULT_SCHEMA_VERSION;
  readonly executionId: string;
  readonly status: TerminalExecutionState;
  readonly diagnostics: readonly ExecutionDiagnostic[];
  readonly timing: ExecutionTiming;
  readonly usage: ExecutionUsagePlaceholder;
  readonly artifacts: readonly ExecutionArtifactPlaceholder[];
  readonly errors: readonly ExecutionFailure[];
  readonly metadata: PromptMetadata;
}

export interface ExecutionResultInput {
  readonly diagnostics?: readonly ExecutionDiagnostic[];
  readonly usage: ExecutionUsagePlaceholder;
  readonly artifacts?: readonly ExecutionArtifactPlaceholder[];
  readonly errors?: readonly ExecutionFailure[];
  readonly metadata?: PromptMetadata;
}

export type ExecutionValidationCode =
  | 'DUPLICATE_EXECUTION_INFORMATION'
  | 'ILLEGAL_EXECUTION_TRANSITION'
  | 'INVALID_CANCELLATION'
  | 'INVALID_EXECUTION_POLICY'
  | 'INVALID_EXECUTION_REQUEST'
  | 'INVALID_EXECUTION_RESULT'
  | 'INVALID_EXECUTION_SNAPSHOT'
  | 'INVALID_RETRY_POLICY'
  | 'INVALID_TIMEOUT_POLICY'
  | 'UNSUPPORTED_EXECUTION_VERSION';

export interface ExecutionValidationIssue {
  readonly code: ExecutionValidationCode;
  readonly path: string;
  readonly message: string;
}
