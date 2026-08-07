import type { Metadata } from 'next';

import { WorkspaceShell } from '../../ui/workspace';
import { loadWorkspacePageContext } from '../../infrastructure/workspace/workspace-project-view';

export const metadata: Metadata = {
  title: 'Project Workspace',
  description: 'Review and control the BuilderAI project workflow.',
};

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  const context = await loadWorkspacePageContext();
  return (
    <WorkspaceShell
      project={context.project}
      runtimeAvailable={context.runtimeAvailable}
      projectProfile={context.profile}
      readiness={context.readiness}
    />
  );
}
