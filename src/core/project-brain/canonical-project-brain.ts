import canonicalProjectBrain from '../../../project-brain.json';

import { parseProjectBrain } from './schemas';
import type { ProjectBrain } from './types';

export function loadCanonicalProjectBrain(): ProjectBrain {
  return parseProjectBrain(canonicalProjectBrain);
}
