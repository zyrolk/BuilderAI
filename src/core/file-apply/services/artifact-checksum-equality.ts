import type { ArtifactChecksum } from '../../response-processor';

export function artifactChecksumsEqual(left: ArtifactChecksum, right: ArtifactChecksum): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}
