import type { ArtifactChecksum } from '../../response-processor';
import type { UpdateScopePlan } from './update-scope-plan';

export type PreservationInvariantKind =
  | 'DOM_ID'
  | 'ARIA_ATTRIBUTE'
  | 'SCRIPT_REFERENCE'
  | 'STYLESHEET_REFERENCE'
  | 'LITERAL_DOM_REFERENCE'
  | 'LOCAL_STORAGE_KEY';

export interface PreservationInvariant {
  readonly kind: PreservationInvariantKind;
  readonly logicalPath: string;
  readonly values: readonly string[];
}

export interface PreservationBaselineEntry {
  readonly logicalPath: string;
  readonly content: string;
  readonly checksum: ArtifactChecksum;
  readonly sizeBytes: number;
}

export interface PreservationContractContent {
  readonly scope: UpdateScopePlan;
  readonly baselines: readonly PreservationBaselineEntry[];
  readonly invariants: readonly PreservationInvariant[];
}
