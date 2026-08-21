import type { IterationFeedback } from '../../application/workspace/iteration-feedback.types';
import type { CorrectionLoopSession } from '../../application/workspace/correction-loop';
import type { ProjectChangePlan } from '../../core/change-planner';
import type { WorkspaceCompletionSnapshot } from './workspace.types';

export interface CorrectionStartResponse {
  readonly session: CorrectionLoopSession;
  readonly correctionRequest: string;
  readonly canPrepare: boolean;
  readonly iterationFeedback?: IterationFeedback;
}

export function formatCorrectionState(state: CorrectionLoopSession['state']): string {
  return state
    .replace(/^CORRECTION_/, '')
    .toLowerCase()
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function correctionSessionHeadline(session: CorrectionLoopSession): string {
  return `Correction attempt ${session.attempt}/${session.maximumAttempts}`;
}

export function isCorrectionAwaitingApproval(session: CorrectionLoopSession | undefined): boolean {
  return session?.state === 'CORRECTION_WAITING_FOR_APPROVAL';
}

export function isCorrectionTerminal(session: CorrectionLoopSession | undefined): boolean {
  if (session === undefined) return false;
  return (
    session.state === 'CORRECTION_PASSED' ||
    session.state === 'CORRECTION_FAILED' ||
    session.state === 'CORRECTION_EXHAUSTED' ||
    session.state === 'CORRECTION_CANCELLED' ||
    session.state === 'CORRECTION_BLOCKED' ||
    session.state === 'CORRECTION_LOOP_DETECTED'
  );
}

export function buildCorrectionStartPayload(
  snapshot: WorkspaceCompletionSnapshot,
  workflowId: string,
  originalTaskSummary?: string,
): Record<string, unknown> {
  return {
    workflowId,
    applyResult: snapshot.applyResult,
    ...(snapshot.verificationReport === undefined
      ? {}
      : { verificationReport: snapshot.verificationReport }),
    ...(snapshot.runtimeBrowserVerificationReport === undefined
      ? {}
      : { runtimeBrowserVerificationReport: snapshot.runtimeBrowserVerificationReport }),
    ...(snapshot.sourcePreparationId === undefined
      ? {}
      : { sourcePreparationId: snapshot.sourcePreparationId }),
    ...(snapshot.priorRequestSummary === undefined
      ? {}
      : { priorRequestSummary: snapshot.priorRequestSummary }),
    ...(originalTaskSummary === undefined ? {} : { originalTaskSummary }),
  };
}

export function buildCorrectionPreparedPayload(
  workflowId: string,
  preparationId: string,
  changePlan: ProjectChangePlan,
): Record<string, unknown> {
  return { workflowId, preparationId, changePlan };
}
