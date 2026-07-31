import type { Metadata } from 'next';

import { loadCanonicalProjectBrain } from '../../core/project-brain';
import { WorkspaceShell, type WorkspaceProjectView } from '../../ui/workspace';

export const metadata: Metadata = {
  title: 'Project Workspace',
  description: 'Review and control the BuilderAI project workflow.',
};

export default function WorkspacePage() {
  const brain = loadCanonicalProjectBrain();
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

  return <WorkspaceShell project={project} />;
}
