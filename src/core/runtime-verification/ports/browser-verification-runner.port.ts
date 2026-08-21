import type { ExecutionCancellationToken } from '../../execution-engine';
import type {
  BrowserVerificationEvidence,
  BrowserVerificationPlan,
} from '../types/runtime-verification.types';

export interface BrowserVerificationRunnerRequest {
  readonly plan: BrowserVerificationPlan;
  readonly artifactDirectory: string;
  readonly cancellation?: ExecutionCancellationToken;
  readonly remainingWorkflowMs?: number;
}

export interface BrowserVerificationRunnerPort {
  verify(request: BrowserVerificationRunnerRequest): Promise<BrowserVerificationEvidence>;
}
