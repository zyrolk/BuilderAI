import type { ExternalTargetReadiness } from '../../application/workspace/external-target-readiness';
import type { WorkspaceProjectProfile } from '../../core/target-project/workspace-project-profile.types';
import type { WorkspaceProjectView } from '../../ui/workspace/workspace.types';

export interface WorkspacePageContext {
  readonly runtimeAvailable: boolean;
  readonly profile: WorkspaceProjectProfile;
  readonly project: WorkspaceProjectView;
  readonly readiness?: ExternalTargetReadiness;
}
