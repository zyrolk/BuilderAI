import type { AIProviderResponse } from '../../core/ai-provider';
import type { ProjectChangePlan } from '../../core/change-planner';
import type { ExecutionRequest, ExecutionResult } from '../../core/execution-engine';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponsePackage } from '../../core/response-processor';
import type { VerificationReport } from '../../core/verification';

import type { FeaturePlan, FeatureTask } from './feature-plan.types';
import type { Gate2ReviewProjection } from './gate2-review';
import type { IterationFeedback } from './iteration-feedback.types';
import type { PrepareContextSelectionDiagnostics } from './prepare-context';

export interface ProviderExecutionOutput {
  readonly providerResponse: AIProviderResponse;
  readonly executionResult: ExecutionResult;
}

export interface ProviderExecutionPort {
  execute(request: ExecutionRequest): Promise<ProviderExecutionOutput>;
}

export interface WorkspacePreparation {
  readonly preparationId: string;
  readonly expiresAt: string;
  readonly responsePackage: ResponsePackage;
  readonly changePlan: ProjectChangePlan;
  readonly gate2Review: Gate2ReviewProjection;
  /** Server-issued apply authorization; required for protected-profile apply requests. */
  readonly applyAuthorizationToken?: string;
  /** Bounded prepare context selection metrics for external-target investigation flows. */
  readonly prepareContextSelection?: PrepareContextSelectionDiagnostics;
}

export interface WorkspaceCompletion {
  readonly applyResult: FileApplyResult;
  readonly verificationReport?: VerificationReport;
}

export interface WorkspaceRuntimeClock {
  now(): Date;
}

export interface WorkspaceRuntimeIdGenerator {
  generate(): string;
}

export interface WorkspaceRuntimeLogger {
  record(event: {
    readonly correlationId: string;
    readonly stage: string;
    readonly outcome: 'STARTED' | 'SUCCEEDED' | 'FAILED';
    readonly durationMs?: number;
    readonly code?: string;
    readonly attempt?: number;
    readonly boundingActive?: boolean;
    readonly compactionActive?: boolean;
    readonly allowlistCount?: number;
    readonly attemptTimeoutMs?: number;
    readonly finishReason?: string;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly providerStatus?: number;
    readonly providerErrorCategory?: 'RATE_LIMIT' | 'UPSTREAM_5XX' | 'TRANSPORT' | 'UNKNOWN';
    readonly providerErrorCode?: string;
    readonly sdkErrorName?: string;
    readonly retryAfterMs?: number;
  }): void;
}

export interface WorkspaceRuntimeConfiguration {
  readonly preparationTtlMs: number;
  readonly maximumPreparations: number;
  readonly providerTimeoutMs: number;
}

export const DEFAULT_WORKSPACE_RUNTIME_CONFIGURATION: WorkspaceRuntimeConfiguration = {
  // 60 minutes (P1-10): large real change plans need genuine review time without losing the
  // AI-generated plan to elapsed time alone. Apply always re-runs its own fresh preflight regardless of
  // how long a preparation was held, so a longer review window introduces no new filesystem-safety risk.
  preparationTtlMs: 60 * 60 * 1_000,
  maximumPreparations: 50,
  providerTimeoutMs: 120_000,
};

export interface FeatureTaskPreparationBinding {
  readonly featurePlanId: string;
  readonly taskId: string;
}

export interface FeatureTaskPrepareInput {
  readonly request: string;
  readonly plan: FeaturePlan;
  readonly task: FeatureTask;
  readonly dependencyOverrides?: readonly string[];
  readonly iterationFeedback?: IterationFeedback;
  readonly iterationPathHints?: readonly string[];
}

export class WorkspaceRuntimeError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'INVALID_ITERATION_FEEDBACK'
      | 'INVALID_FEATURE_PLAN'
      | 'FEATURE_PLAN_NOT_FOUND'
      | 'PROJECT_CONTEXT_INVALID'
      | 'EXTERNAL_TARGET_ONBOARDING_REQUIRED'
      | 'EXTERNAL_TARGET_READINESS_BLOCKED'
      | 'PREPARATION_NOT_FOUND'
      | 'PREPARATION_EXPIRED'
      | 'APPROVAL_REQUIRED'
      | 'UNAUTHENTICATED'
      | 'UNAUTHORIZED'
      | 'CSRF_VALIDATION_FAILED'
      | 'APPLY_AUTHORIZATION_REQUIRED'
      | 'APPLY_PATH_CONFLICT'
      | 'BASELINE_INTEGRITY_REQUIRED'
      | 'WORKFLOW_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceRuntimeError';
  }
}
