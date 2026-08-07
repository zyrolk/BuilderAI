import type { WorkspaceProjectProfile } from '../../../core/target-project';
import { WorkspaceRuntimeError } from '../workspace-runtime.types';
import type { ExternalTargetReadiness } from './external-target-readiness.types';

export type ExternalTargetWorkflowAction = 'INVESTIGATE' | 'PREPARE' | 'APPLY';

export function assertExternalTargetWorkflowAllowed(
  profile: WorkspaceProjectProfile,
  readiness: ExternalTargetReadiness | undefined,
  action: ExternalTargetWorkflowAction,
): void {
  if (profile !== 'EXTERNAL_TARGET') return;
  if (readiness === undefined || readiness.status === 'BLOCKED' || readiness.blockers.length > 0) {
    const detail =
      readiness?.blockers[0]?.message ??
      'External target readiness could not be confirmed. Complete onboarding before using the workspace workflow.';
    throw new WorkspaceRuntimeError(
      'EXTERNAL_TARGET_READINESS_BLOCKED',
      `External target is not ready for ${action.toLowerCase()}. ${detail}`,
    );
  }
}
