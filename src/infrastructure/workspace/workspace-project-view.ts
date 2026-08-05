import { loadCanonicalProjectBrain, type ProjectBrain } from '../../core/project-brain';
import { loadWorkspaceProjectBrain } from '../../core/target-project';
import { loadLocalWorkspaceRuntimeConfiguration } from './local-runtime-configuration';

export function loadWorkspaceProjectBrainForView(): ProjectBrain {
  if (process.env.BUILDERAI_LIVE_WORKFLOW_ENABLED !== 'true') {
    return loadCanonicalProjectBrain();
  }
  const { projectRoot, projectProfile } = loadLocalWorkspaceRuntimeConfiguration();
  return loadWorkspaceProjectBrain(projectRoot, projectProfile);
}
