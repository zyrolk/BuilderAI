import type { Metadata } from 'next';

import { isLocalWorkspaceRuntimeConfigured } from '../../infrastructure/workspace';
import { loadWorkspaceProjectBrainForView } from '../../infrastructure/workspace/workspace-project-view';
import { WorkspaceShell, type WorkspaceProjectView } from '../../ui/workspace';

export const metadata: Metadata = {
  title: 'Project Workspace',
  description: 'Review and control the BuilderAI project workflow.',
};

export const dynamic = 'force-dynamic';

export default function WorkspacePage() {
  const brain = loadWorkspaceProjectBrainForView();
  const project: WorkspaceProjectView = {
    id: brain.blueprint.projectId,
    name: brain.blueprint.name,
    vision: brain.blueprint.vision,
    currentMilestone: brain.progressLog.currentMilestone,
    architectureStatus: 'Core boundaries validated',
    moduleCount: brain.blueprint.folderOwnership.filter(({ path }) => path.startsWith('src/'))
      .length,
    completedSprintCount: brain.progressLog.completedSprints.length,
  };

  return (
    <WorkspaceShell project={project} runtimeAvailable={isLocalWorkspaceRuntimeConfigured()} />
  );
}
