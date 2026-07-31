import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  loadCanonicalProjectBrain,
  parseProjectBrain,
  type ProjectBrain,
} from '../../core/project-brain';
import {
  isLocalWorkspaceRuntimeConfigured,
  loadLocalWorkspaceRuntimeConfiguration,
} from './local-runtime-configuration';

export function loadWorkspaceProjectBrainForView(): ProjectBrain {
  if (!isLocalWorkspaceRuntimeConfigured()) return loadCanonicalProjectBrain();
  const { projectRoot } = loadLocalWorkspaceRuntimeConfiguration();
  return parseProjectBrain(
    JSON.parse(readFileSync(path.join(projectRoot, 'project-brain.json'), 'utf8')) as unknown,
  );
}
