import type { ProjectChangePlan } from '../../core/change-planner';
import { WorkspaceRuntimeError } from './workspace-runtime.types';
import type { WorkspaceSecurityProfile } from './workspace-authorization.types';

export class WorkspaceApplyPolicyService {
  assertUpdateBaselineIntegrity(
    profile: WorkspaceSecurityProfile,
    changePlan: ProjectChangePlan,
  ): void {
    if (profile !== 'PROTECTED') return;

    const missing = changePlan.changeSet.operations
      .filter((operation) => operation.kind === 'UPDATE_FILE')
      .filter((operation) => operation.baselineContentChecksum === undefined)
      .map(({ logicalPath }) => logicalPath);

    if (missing.length === 0) return;

    throw new WorkspaceRuntimeError(
      'BASELINE_INTEGRITY_REQUIRED',
      'Protected apply requires baseline integrity evidence for every update operation.',
    );
  }
}
