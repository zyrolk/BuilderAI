import { BlueprintReaderService } from '../blueprint-reader';
import type { DocumentSource } from '../blueprint-reader';
import { ExternalTargetProjectReaderService } from './external-target-project-reader.service';
import type { ProjectContextReaderPort } from './project-context-reader.port';
import type { WorkspaceProjectProfile } from './workspace-project-profile.types';

export function createProjectContextReader(input: {
  readonly profile: WorkspaceProjectProfile;
  readonly projectRoot: string;
  readonly source: DocumentSource;
}): ProjectContextReaderPort {
  if (input.profile === 'BUILDERAI_SELF') {
    return new BlueprintReaderService(input.source);
  }
  return new ExternalTargetProjectReaderService(input.projectRoot, input.source);
}
