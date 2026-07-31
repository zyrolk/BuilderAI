import type { AIProviderResponse } from '../../core/ai-provider';
import type { ProjectChangePlan } from '../../core/change-planner';
import type { ExecutionRequest, ExecutionResult } from '../../core/execution-engine';
import type { FileApplyResult } from '../../core/file-apply';
import type { ResponsePackage } from '../../core/response-processor';
import type { VerificationReport } from '../../core/verification';

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
  }): void;
}

export interface WorkspaceRuntimeConfiguration {
  readonly preparationTtlMs: number;
  readonly maximumPreparations: number;
  readonly providerTimeoutMs: number;
}

export const DEFAULT_WORKSPACE_RUNTIME_CONFIGURATION: WorkspaceRuntimeConfiguration = {
  preparationTtlMs: 15 * 60 * 1_000,
  maximumPreparations: 50,
  providerTimeoutMs: 120_000,
};

export class WorkspaceRuntimeError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'PROJECT_CONTEXT_INVALID'
      | 'PREPARATION_NOT_FOUND'
      | 'PREPARATION_EXPIRED'
      | 'APPROVAL_REQUIRED'
      | 'WORKFLOW_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceRuntimeError';
  }
}
